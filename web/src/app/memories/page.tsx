import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, memories, users } from "@/db/schema";
import { getUser } from "@/lib/auth";
import MemoryList from "@/components/MemoryList";

export const dynamic = "force-dynamic";

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const me = await getUser();
  if (!me) redirect("/login");

  const { user: requested } = await searchParams;
  // Only an admin may look at someone else's memories.
  const targetId = me.role === "admin" && requested ? requested : me.id;

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) redirect("/memories");

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      kind: memories.kind,
      createdAt: memories.createdAt,
      sourceId: memories.sourceConversationId,
      sourceTitle: conversations.title,
    })
    .from(memories)
    .leftJoin(conversations, eq(conversations.id, memories.sourceConversationId))
    .where(eq(memories.userId, targetId))
    .orderBy(desc(memories.createdAt));

  const people =
    me.role === "admin"
      ? await db
          .select({ id: users.id, name: users.name, role: users.role })
          .from(users)
          .orderBy(users.name)
      : [];

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">What it remembers</h1>
        <Link href="/chat" className="shrink-0 text-sm hover:underline">
          ← Back to chat
        </Link>
      </div>

      <p className="text-sm" style={{ color: "var(--muted)" }}>
        These are facts the assistant has picked up from conversations and replays
        into later chats. Deleting one makes it forget. Nothing here changes the
        model itself — it is just stored text.
      </p>

      <MemoryList
        memories={rows.map((r) => ({
          id: r.id,
          content: r.content,
          kind: r.kind,
          createdAt: r.createdAt.toISOString(),
          sourceId: r.sourceId,
          sourceTitle: r.sourceTitle,
        }))}
        targetUserId={targetId}
        targetName={target.name}
        isSelf={targetId === me.id}
        people={people}
      />
    </main>
  );
}
