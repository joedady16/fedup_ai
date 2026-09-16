export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  if (await getUser()) redirect("/chat");

  return (
    <main className="min-h-dvh grid place-items-center p-4">
      <div
        className="w-full max-w-sm rounded-2xl border p-8"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">Fedup AI</h1>
        <p className="mt-1 mb-6 text-sm" style={{ color: "var(--muted)" }}>
          Private assistant for the family.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
