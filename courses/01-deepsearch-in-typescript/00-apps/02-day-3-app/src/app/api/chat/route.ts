import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { model } from "~/model";
import { auth } from "~/server/auth";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { z } from "zod";
import { upsertChat } from "~/server/db/queries";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { chats } from "~/server/db/schema";
import { Langfuse } from "langfuse";
import { env } from "~/env";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId: string;
    isNewChat: boolean;
  };

  const { messages, chatId, isNewChat } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  // Determine the current chat ID - if it's a new chat, we'll create one
  const currentChatId = chatId;
  
  // If this is a new chat, create it with the user's message
  if (isNewChat) {
    await upsertChat({
      userId: session.user.id,
      chatId: chatId,
      title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
      messages: messages, // Only save the user's message initially
    });
  } else {
    // Verify the chat belongs to the user
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  // Create Langfuse trace with session and user information
  const trace = langfuse.trace({
    sessionId: currentChatId,
    name: "chat",
    userId: session.user.id,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // If this is a new chat, send the chat ID to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: chatId,
        });
      }

      // Get current date and time for date awareness
      const currentDate = new Date().toISOString();
      const formattedDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      const result = streamText({
        model,
        messages,
        maxSteps: 10,
        system: `You are a helpful AI assistant with access to real-time web search and web scraping capabilities. 

CURRENT DATE AND TIME: ${formattedDate} (${currentDate})

When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. When you find relevant URLs from search results, use the scrapePages tool to extract the full content of those pages for more detailed analysis
8. The scrapePages tool will return the full text content of web pages in markdown format, allowing you to provide more comprehensive answers
9. IMPORTANT: When scraping pages, be aggressive and comprehensive - scrape 4-6 URLs per query to get diverse perspectives and thorough coverage
10. Always select a diverse set of sources from different websites, domains, and perspectives to provide balanced information
11. Prioritize scraping over just using search snippets - the full content is much more valuable for detailed analysis
12. IMPORTANT: When users ask for "up to date" information, "latest" news, "current" events, or anything time-sensitive, use the current date (${formattedDate}) to provide context about how recent the information is
13. When search results include publication dates, mention them to help users understand how current the information is
14. For time-sensitive queries like weather, sports scores, stock prices, or breaking news, emphasize the importance of real-time data

Remember to use the searchWeb tool whenever you need to find current information, and use the scrapePages tool when you need to analyze the full content of specific web pages. Be thorough in your scraping approach to provide the most comprehensive answers possible.`,
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper(
                { q: query, num: 10 },
                abortSignal,
              );

              return results.organic.map((result) => ({
                title: result.title,
                link: result.link,
                snippet: result.snippet,
                date: result.date, // Include publication date if available
              }));
            },
          },
          scrapePages: {
            parameters: z.object({
              urls: z.array(z.string()).describe("The URLs to scrape"),
            }),
            execute: async ({ urls }, { abortSignal }) => {
              const results = await bulkCrawlWebsites({ urls });
          
              if (!results.success) {
                return {
                  error: results.error,
                  results: results.results.map(({ url, result }) => ({
                    url,
                    success: result.success,
                    data: result.success ? result.data : result.error,
                  })),
                };
              }
          
              return {
                results: results.results.map(({ url, result }) => ({
                  url,
                  success: result.success,
                  data: result.data,
                })),
              };
            }
          }
        },
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            return;
          }

          // Save the complete chat history
          await upsertChat({
            userId: session.user.id,
            chatId: chatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          // Flush the trace to Langfuse
          await langfuse.flushAsync();
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: `agent`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
