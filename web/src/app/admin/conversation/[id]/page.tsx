import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, users } from "@/db/schema";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Parent visibility: an admin can read any conversation in the house. */
export default async function AdminConversation({ params }: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/chat");

  const { id } = await params;
  const [convo] = await db
    .select({ title: conversations.title, who: users.name })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.userId))
    .where(eq(conversations.id, id))
    .limit(1);
  if (!convo) notFound();

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <Link href="/admin" className="text-sm hover:underline">← Back to settings</Link>
      <div>
        <h1 className="text-xl font-semibold">{convo.title}</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>{convo.who}</p>
      </div>

      <div className="space-y-3">
        {rows.filter((m) => m.role !== "system").map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm prose-plain"
                 style={{
                   background: m.role === "user" ? "var(--bubble-user)" : "var(--bubble-ai)",
                   color: m.role === "user" ? "#fff" : "var(--text)",
                   borderColor: "var(--border)",
                 }}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
