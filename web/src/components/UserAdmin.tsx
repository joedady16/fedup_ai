"use client";

import { useActionState } from "react";
import { createUserAction, deleteUserAction, type FormState } from "@/app/actions";

const initial: FormState = {};

type Account = { id: string; name: string; email: string; role: string };

export default function UserAdmin({ accounts, meId }: { accounts: Account[]; meId: string }) {
  const [state, action, pending] = useActionState(createUserAction, initial);
  const [delState, delAction] = useActionState(deleteUserAction, initial);

  const border = { borderColor: "var(--border)" };
  const field = { background: "var(--bg)", ...border };

  return (
    <section className="rounded-xl border p-5" style={{ background: "var(--panel)", ...border }}>
      <h2 className="font-medium">Accounts</h2>

      <ul className="my-4 divide-y text-sm" style={border}>
        {accounts.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="font-medium">{u.name}</span>{" "}
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {u.email} · {u.role}
              </span>
            </div>
            {u.id !== meId && (
              <form action={delAction}>
                <input type="hidden" name="id" value={u.id} />
                <button type="submit" className="text-xs hover:underline" style={{ color: "#dc2626" }}>
                  Remove
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {delState.error && <p className="mb-2 text-sm" style={{ color: "#dc2626" }}>{delState.error}</p>}

      <form action={action} className="grid gap-2 sm:grid-cols-2">
        <input name="name" placeholder="Name" required
               className="rounded-lg border px-3 py-2 text-sm" style={field} />
        <input name="email" type="email" placeholder="Email" required
               className="rounded-lg border px-3 py-2 text-sm" style={field} />
        <input name="password" type="password" placeholder="Password (min 8 characters)"
               required minLength={8}
               className="rounded-lg border px-3 py-2 text-sm" style={field} />
        <select name="role" defaultValue="kid"
                className="rounded-lg border px-3 py-2 text-sm" style={field}>
          <option value="kid">Kid — filtered and supervised</option>
          <option value="adult">Adult — unrestricted</option>
          <option value="admin">Admin — can manage accounts</option>
        </select>

        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={pending}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: "var(--accent)" }}>
            {pending ? "Creating…" : "Add account"}
          </button>
          {state.error && <span className="text-sm" style={{ color: "#dc2626" }}>{state.error}</span>}
          {state.ok && <span className="text-sm" style={{ color: "#16a34a" }}>{state.ok}</span>}
        </div>
      </form>
    </section>
  );
}
