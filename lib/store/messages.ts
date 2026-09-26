/**
 * What was said, by voice or in the chat, per person — so their dashboard can
 * show the conversation beside the courses it led to.
 */

import { randomUUID } from "node:crypto";
import { createCollection } from "./collection";

export type Message = {
  id: string;
  beneficiaryId: string;
  at: number;
  role: "user" | "assistant";
  text: string;
  channel: "voice" | "chat";
};

export const messages = createCollection<Message>("messages", { max: 200000 });

export async function appendMessage(m: Omit<Message, "id" | "at">): Promise<void> {
  if (!m.text.trim()) return;
  await messages.upsert({ ...m, id: randomUUID(), at: Date.now() });
}

/** A person's conversation, oldest first. */
export async function conversationOf(beneficiaryId: string, limit = 300): Promise<Message[]> {
  const list = await messages.list({ beneficiaryId }, { sortBy: "at", desc: true, limit });
  return list.reverse();
}

export async function eraseMessages(beneficiaryId: string): Promise<void> {
  for (const m of await messages.list({ beneficiaryId }, { limit: 100000 })) await messages.remove(m.id);
}
