import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { model } from "~/models";
import { auth } from "~/server/auth";
import { z } from "zod";
import { searchSerper } from "~/serper";
import { upsertChat } from "~/server/db/queries";
import { chats, db } from "~/server/db";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  const { messages, chatId } = body;

  // Create a new chat if no chatId is provided
  const currentChatId = chatId || crypto.randomUUID();
  const chatTitle = messages[messages.length - 1]?.content?.slice(0, 100) || "New Chat";

  // Create the chat early before streaming starts
  if (!chatId) {
    await upsertChat({
      userId: session.user.id,
      chatId: currentChatId,
      title: chatTitle,
      messages,
    });
  } else {
    // Verify the chat belongs to the user
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });
    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // Send the new chat ID if this is a new chat
      if (!chatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: currentChatId,
        });
      }

      const result = streamText({
        model,
        messages,
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
              }));
            },
          },
        },
        system: `You are an AI assistant with access to a web search tool. For any question that may require up-to-date information, always use the searchWeb tool. Always cite your sources with inline markdown links, e.g. [source](url). If you use information from a search result, include the link in your answer.`,
        maxSteps: 10,
        onFinish({ text, finishReason, usage, response }) {
          const responseMessages = response.messages;

          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages,
          });

          // Save the updated messages to the database
          upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: chatTitle,
            messages: updatedMessages,
          }).catch((error) => {
            console.error("Failed to save chat:", error);
          });
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
} 