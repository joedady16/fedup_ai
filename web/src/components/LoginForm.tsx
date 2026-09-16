"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "@/app/actions";

const initial: FormState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input
        name="email"
        type="email"
        autoComplete="username"
        required
        placeholder="Email"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      {state.error && (
        <p className="text-sm" role="alert" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
