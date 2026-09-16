import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, conversations, safetyEvents } from "@/db/schema";
import { getUser } from "@/lib/auth";
import UserAdmin from "@/components/UserAdmin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await getUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/chat");

  const accounts = await db.select().from(users).orderBy(desc(users.createdAt));

  const blocks = await db
    .select({
      id: safetyEvents.id,
      surface: safetyEvents.surface,
      prompt: safetyEvents.prompt,
      reason: safetyEvents.reason,
      createdAt: safetyEvents.createdAt,
      who: users.name,
    })
    .from(safetyEvents)
    .leftJoin(users, eq(users.id, safetyEvents.userId))
    .orderBy(desc(safetyEvents.createdAt))
    .limit(25);

  const recent = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      who: users.name,
      role: users.role,
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(25);

  const border = { borderColor: "var(--border)" };
  const panel = { background: "var(--panel)", ...border };

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Family settings</h1>
        <Link href="/chat" className="text-sm hover:underline">← Back to chat</Link>
      </div>

      <UserAdmin
        accounts={accounts.map((u) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
        }))}
        meId={me.id}
      />

      <section className="rounded-xl border p-5" style={panel}>
        <h2 className="font-medium">Blocked prompts</h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Anything a child account asked for that was refused.
        </p>
        {blocks.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Nothing blocked so far.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="rounded-lg border p-3" style={border}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{b.who ?? "unknown"}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {b.surface} · {new Date(b.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 break-words">{b.prompt}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{b.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border p-5" style={panel}>
        <h2 className="font-medium">Recent conversations</h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Everyone's chats, newest first.
        </p>
        {recent.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No conversations yet.</p>
        ) : (
          <ul className="divide-y text-sm" style={border}>
            {recent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/admin/conversation/${c.id}`} className="truncate hover:underline">
                  {c.title}
                </Link>
                <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                  {c.who} · {new Date(c.updatedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
