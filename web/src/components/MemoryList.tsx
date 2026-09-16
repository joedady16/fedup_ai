"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addMemoryAction, clearMemoriesAction, deleteMemoryAction, type FormState,
} from "@/app/actions";

export type MemoryRow = {
  id: string;
  content: string;
  kind: string;
  createdAt: string;
  sourceId: string | null;
  sourceTitle: string | null;
};

const initial: FormState = {};

export default function MemoryList({
  memories, targetUserId, targetName, isSelf, people,
}: {
  memories: MemoryRow[];
  targetUserId: string;
  targetName: string;
  isSelf: boolean;
  people: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [state, addAction, pending] = useActionState(addMemoryAction, initial);

  const border = { borderColor: "var(--border)" };
  const panel = { background: "var(--panel)", ...border };

  return (
    <div className="space-y-6">
      {people.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="who" style={{ color: "var(--muted)" }}>
            Viewing:
          </label>
          <select
            id="who"
            value={targetUserId}
            onChange={(e) => router.push(`/memories?user=${e.target.value}`)}
            className="rounded-lg border px-2 py-1 text-sm"
            style={{ background: "var(--bg)", ...border }}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>
        </div>
      )}

      <section className="rounded-xl border p-5" style={panel}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-medium">
            {isSelf ? "Your memories" : `${targetName}'s memories`}{" "}
            <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
              ({memories.length})
            </span>
          </h2>

          {memories.length > 0 && (
            <form
              action={clearMemoriesAction}
              onSubmit={(e) => {
                if (
                  !window.confirm(
                    `Forget all ${memories.length} memories for ${isSelf ? "you" : targetName}?\n\n` +
                      "This cannot be undone. Conversations are not affected.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="userId" value={targetUserId} />
              <button type="submit" className="text-xs hover:underline" style={{ color: "#dc2626" }}>
                Forget everything
              </button>
            </form>
          )}
        </div>

        {memories.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nothing remembered yet. The assistant picks things up as you chat.
          </p>
        ) : (
          <ul className="divide-y text-sm" style={border}>
            {memories.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="break-words">{m.content}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(m.createdAt).toLocaleDateString()}
                    {m.sourceId && m.sourceTitle ? (
                      <>
                        {" · from "}
                        <Link href={`/chat/${m.sourceId}`} className="underline hover:opacity-70">
                          {m.sourceTitle.slice(0, 40)}
                        </Link>
                      </>
                    ) : (
                      " · source chat deleted"
                    )}
                  </p>
                </div>

                <form action={deleteMemoryAction} className="shrink-0">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="userId" value={targetUserId} />
                  <button
                    type="submit"
                    title="Forget this"
                    aria-label={`Forget: ${m.content}`}
                    className="text-xs hover:underline"
                    style={{ color: "#dc2626" }}
                  >
                    Forget
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border p-5" style={panel}>
        <h2 className="font-medium">Teach it something</h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Add a fact directly instead of waiting for it to be picked up.
        </p>
        <form action={addAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={targetUserId} />
          <input
            name="content"
            required
            maxLength={300}
            placeholder={
              isSelf ? "e.g. I'm vegetarian" : `e.g. ${targetName} is allergic to peanuts`
            }
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--bg)", ...border }}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {pending ? "Saving…" : "Remember"}
          </button>
        </form>
        {state.error && <p className="mt-2 text-sm" style={{ color: "#dc2626" }}>{state.error}</p>}
        {state.ok && <p className="mt-2 text-sm" style={{ color: "#16a34a" }}>{state.ok}</p>}
      </section>
    </div>
  );
}
