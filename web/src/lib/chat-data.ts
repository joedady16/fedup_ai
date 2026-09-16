import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { ConvoSummary, UiMessage } from "@/components/ChatShell";

export async function listConversations(userId: string): Promise<ConvoSummary[]> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      pinned: conversations.pinned,
      archivedAt: conversations.archivedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    // Pinned float to the top; everything else is most-recent-first.
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: r.pinned,
    archived: r.archivedAt !== null,
  }));
}

/** Returns null when the conversation isn't this user's. */
export async function loadMessages(
  userId: string,
  conversationId: string,
): Promise<UiMessage[] | null> {
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  return rows
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      attachments: m.attachments ?? [],
    }));
}
