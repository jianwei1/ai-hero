import { db, chats, messages } from "./index";
import { eq, and } from "drizzle-orm";
import type { Message } from "ai";

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: Message[];
}) => {
  // Check if chat exists and belongs to user
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, opts.chatId), eq(chats.userId, opts.userId)),
  });

  if (!chat) {
    // Create new chat
    await db.insert(chats).values({
      id: opts.chatId,
      userId: opts.userId,
      title: opts.title,
    });
  } else {
      // If chat exists but belongs to a different user, throw error
  if (chat.userId !== opts.userId) {
    throw new Error("Chat ID already exists under a different user");
  }
    // Update title if changed
    if (chat.title !== opts.title) {
      await db.update(chats)
        .set({ title: opts.title })
        .where(eq(chats.id, opts.chatId));
    }
    // Delete existing messages
    await db.delete(messages).where(eq(messages.chatId, opts.chatId));
  }

  // Insert new messages
  if (opts.messages.length > 0) {
    await db.insert(messages).values(
      opts.messages.map((msg, i) => ({
        chatId: opts.chatId,
        role: msg.role,
        parts: msg.parts,
        order: i,
      }))
    );
  }
};

export const getChat = async (opts: { userId: string; chatId: string }) => {
  const { userId, chatId } = opts;

 const chat = await db.query.chats.findFirst({
  where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
  with: {
    messages: {
      orderBy: (messages, { asc }) => [asc(messages.order)],
    },
  },
});
  if (!chat) return null;
  const msgs = await db.query.messages.findMany({
    where: eq(messages.chatId, chatId),
    orderBy: [messages.order],
  });
  return {
    ...chat,
    messages: msgs,
  };
};

export const getChats = async (opts: { userId: string }) => {
    const { userId } = opts;
    return await db.query.chats.findMany({
      where: eq(chats.userId, userId),
      orderBy: (chats, { desc }) => [desc(chats.updatedAt)],
    });
  };