import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
} from "ai";
import { model } from "~/models";
import { auth } from "~/server/auth";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

      const result = streamText({
        model,
        messages,
        system: `You are an AI assistant with access to search grounding. For any question that may require up-to-date information, use search grounding to find current information. Always cite your sources with inline markdown links, e.g. [source](url). If you use information from a search result, include the link in your answer.`,
        maxSteps: 10,
      });

      result.mergeIntoDataStream(dataStream, {
        sendSources: true,
      });
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
} 