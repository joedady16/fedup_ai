"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { logoutAction } from "@/app/actions";

export type UiMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
  sources?: string[];
  pending?: boolean;
};

export type ConvoSummary = { id: string; title: string };

type Props = {
  user: { name: string; role: "admin" | "adult" | "kid" };
  conversations: ConvoSummary[];
  initialMessages: UiMessage[];
  conversationId: string | null;
  smartAvailable: boolean;
  imagesAvailable: boolean;
};

export default function ChatShell({
  user, conversations, initialMessages, conversationId,
  smartAvailable, imagesAvailable,
}: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [smart, setSmart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [convId, setConvId] = useState(conversationId);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "", pending: true },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          message: text,
          mode: smart ? "smart" : "local",
        }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: "Request failed." }));
        throw new Error(j.error ?? "Request failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let newId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;

          const ev = JSON.parse(line) as {
            type: string;
            text?: string;
            message?: string;
            conversationId?: string;
            files?: string[];
          };

          if (ev.type === "meta" && ev.conversationId) {
            newId = ev.conversationId;
            setConvId(ev.conversationId);
          } else if (ev.type === "sources") {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { ...next[next.length - 1], sources: ev.files };
              return next;
            });
          } else if (ev.type === "delta") {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                content: last.content + (ev.text ?? ""),
                pending: false,
              };
              return next;
            });
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "Something went wrong.");
          }
        }
      }

      // Refresh the sidebar so a brand-new conversation shows up.
      if (newId && !conversationId) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setMessages((m) => m.filter((x) => !(x.role === "assistant" && x.pending)));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: `Reading "${file.name}"…`, pending: true },
    ]);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const j = await res.json();

      setMessages((m) => m.slice(0, -1));
      if (!res.ok) throw new Error(j.error ?? "Could not read that file.");

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            `I've read "${file.name}" (${j.chunks} sections). ` +
            `Ask me anything about it.`,
        },
      ]);
    } catch (e) {
      setMessages((m) => m.filter((x) => !x.pending));
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function makePicture() {
    const prompt = input.trim();
    if (!prompt || busy) return;

    setError(null);
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: `Draw: ${prompt}` },
      { role: "assistant", content: "Painting…", pending: true },
    ]);

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, conversationId: convId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not make that picture.");

      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          content: "Here you go:",
          attachments: [j.url],
        };
        return next;
      });
    } catch (e) {
      setMessages((m) => m.filter((x) => !x.pending));
      setError(e instanceof Error ? e.message : "Image generation failed.");
    } finally {
      setBusy(false);
    }
  }

  const border = { borderColor: "var(--border)" };

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "flex" : "hidden"} md:flex w-64 shrink-0 flex-col border-r
                    absolute md:static inset-y-0 left-0 z-20`}
        style={{ background: "var(--panel)", ...border }}
      >
        <div className="flex items-center justify-between p-3 border-b" style={border}>
          <span className="font-semibold">Fedup AI</span>
          <Link
            href="/chat"
            className="rounded-md px-2 py-1 text-xs font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            New
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="px-2 py-3 text-xs" style={{ color: "var(--muted)" }}>
              No conversations yet.
            </p>
          )}
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/chat/${c.id}`}
              onClick={() => setSidebarOpen(false)}
              className="block truncate rounded-md px-2 py-2 text-sm hover:opacity-80"
              style={{ background: c.id === convId ? "var(--bg)" : "transparent" }}
            >
              {c.title}
            </Link>
          ))}
        </nav>

        <div className="border-t p-3 text-xs space-y-2" style={border}>
          <div style={{ color: "var(--muted)" }}>
            {user.name} · {user.role}
          </div>
          {user.role === "admin" && (
            <Link href="/admin" className="block hover:underline">
              Family settings
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className="hover:underline">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-3 border-b px-4 py-2 md:hidden"
          style={{ background: "var(--panel)", ...border }}
        >
          <button onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle menu">
            ☰
          </button>
          <span className="font-semibold">Fedup AI</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-4">
            {messages.length === 0 && (
              <div className="pt-20 text-center" style={{ color: "var(--muted)" }}>
                <p className="text-lg">Hi {user.name} — what can I help with?</p>
                <p className="mt-2 text-sm">
                  Ask a question, upload a document, or describe a picture to draw.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm"
                  style={{
                    background: m.role === "user" ? "var(--bubble-user)" : "var(--bubble-ai)",
                    color: m.role === "user" ? "#fff" : "var(--text)",
                    border: m.role === "user" ? "none" : "1px solid var(--border)",
                  }}
                >
                  {m.pending && !m.content ? (
                    <span style={{ color: "var(--muted)" }}>Thinking…</span>
                  ) : (
                    <div className="prose-plain">{m.content}</div>
                  )}

                  {m.attachments?.map((src) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={src} src={src} alt="Generated picture"
                         className="mt-2 rounded-lg max-w-full" />
                  ))}

                  {m.sources?.length ? (
                    <p className="mt-2 text-xs opacity-70">
                      Sources: {m.sources.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t p-3" style={{ background: "var(--panel)", ...border }}>
          <div className="mx-auto max-w-3xl space-y-2">
            {error && (
              <p className="text-sm" role="alert" style={{ color: "#dc2626" }}>
                {error}
              </p>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.csv,.json,.log"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title="Upload a document"
                className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                style={border}
              >
                📎
              </button>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask anything…"
                className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{ background: "var(--bg)", ...border, maxHeight: "9rem" }}
              />

              {imagesAvailable && (
                <button
                  onClick={() => void makePicture()}
                  disabled={busy || !input.trim()}
                  title="Draw this"
                  className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  style={border}
                >
                  🎨
                </button>
              )}
              <button
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                Send
              </button>
            </div>

            {smartAvailable && (
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                <input
                  type="checkbox"
                  checked={smart}
                  onChange={(e) => setSmart(e.target.checked)}
                />
                Smart mode (uses Claude — costs money, needs internet)
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
