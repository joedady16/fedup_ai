"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  logoutAction, togglePinAction, toggleArchiveAction, deleteConversationAction,
} from "@/app/actions";

export type UiMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
  sources?: string[];
  links?: { url: string; title?: string }[];
  pending?: boolean;
};

export type ConvoSummary = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
};

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
  const [showArchived, setShowArchived] = useState(false);

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
            url?: string;
            links?: { url: string; title?: string }[];
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
          } else if (ev.type === "links" && ev.links) {
            const links = ev.links;
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { ...next[next.length - 1], links };
              return next;
            });
          } else if (ev.type === "status") {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: ev.text ?? "",
                pending: true,
              };
              return next;
            });
          } else if (ev.type === "image" && ev.url) {
            const url = ev.url;
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                attachments: [...(last.attachments ?? []), url],
                pending: false,
              };
              return next;
            });
          } else if (ev.type === "delta") {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              // A "status" placeholder is replaced, real deltas accumulate.
              const base = last.pending ? "" : last.content;
              next[next.length - 1] = {
                ...last,
                content: base + (ev.text ?? ""),
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

  const active = conversations.filter((c) => !c.archived);
  const pinned = active.filter((c) => c.pinned);
  const unpinned = active.filter((c) => !c.pinned);
  const archived = conversations.filter((c) => c.archived);

  const border = { borderColor: "var(--border)" };

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      {/* Dim the chat behind the drawer on small screens. */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          aria-hidden
        />
      )}

      <aside
        className={`${sidebarOpen ? "flex" : "hidden"} md:flex w-[17rem] shrink-0 flex-col border-r
                    fixed md:static inset-y-0 left-0 z-20 shadow-xl md:shadow-none`}
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
          {active.length === 0 && archived.length === 0 && (
            <p className="px-2 py-3 text-xs" style={{ color: "var(--muted)" }}>
              No conversations yet.
            </p>
          )}

          {pinned.length > 0 && (
            <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide"
               style={{ color: "var(--muted)" }}>
              Pinned
            </p>
          )}
          {pinned.map((c) => (
            <ConversationRow key={c.id} convo={c} current={c.id === convId}
                             onNavigate={() => setSidebarOpen(false)} />
          ))}

          {unpinned.map((c) => (
            <ConversationRow key={c.id} convo={c} current={c.id === convId}
                             onNavigate={() => setSidebarOpen(false)} />
          ))}

          {archived.length > 0 && (
            <>
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="mt-2 w-full px-2 py-1 text-left text-[10px] uppercase tracking-wide hover:opacity-80"
                style={{ color: "var(--muted)" }}
              >
                {showArchived ? "▾" : "▸"} Archived ({archived.length})
              </button>
              {showArchived &&
                archived.map((c) => (
                  <ConversationRow key={c.id} convo={c} current={c.id === convId}
                                   onNavigate={() => setSidebarOpen(false)} />
                ))}
            </>
          )}
        </nav>

        <div className="border-t p-3 text-sm" style={border}>
          <div className="px-1 pb-2 text-xs" style={{ color: "var(--muted)" }}>
            {user.name} · {user.role}
          </div>
          <Link href="/memories" className="block rounded-md px-1 py-1.5 hover:underline">
            What it remembers
          </Link>
          {user.role === "admin" && (
            <Link href="/admin" className="block rounded-md px-1 py-1.5 hover:underline">
              Family settings
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className="w-full px-1 py-1.5 text-left hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 md:hidden"
          style={{ background: "var(--panel)", ...border }}
        >
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle menu"
            className="h-10 w-10 rounded-lg text-lg"
          >
            ☰
          </button>
          <span className="font-semibold">Fedup AI</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[52rem] space-y-5 px-4 py-6 sm:px-6">
            {messages.length === 0 && (
              <div className="pt-24 text-center" style={{ color: "var(--muted)" }}>
                <p className="text-2xl font-medium" style={{ color: "var(--text)" }}>
                  Hi {user.name}
                </p>
                <p className="mt-2 text-[15px]">What can I help with?</p>
                <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed">
                  Ask a question, upload a document, ask for a picture, or say
                  &ldquo;draw a diagram of&hellip;&rdquo;
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
                    m.role === "user" ? "max-w-[85%] sm:max-w-[75%]" : "max-w-full sm:max-w-[90%]"
                  }`}
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

                  {m.links?.length ? (
                    <div className="mt-2 space-y-0.5 text-xs opacity-80">
                      <p className="font-medium">From the web:</p>
                      {m.links.map((l) => (
                        <a
                          key={l.url}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="block truncate underline hover:opacity-70"
                          title={l.url}
                        >
                          {l.title || l.url}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t p-3" style={{ background: "var(--panel)", ...border }}>
          <div className="mx-auto w-full max-w-[52rem] space-y-2">
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
                className="h-11 w-11 shrink-0 rounded-xl border text-base disabled:opacity-50"
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
                className="flex-1 resize-none rounded-xl border px-4 py-3 text-[15px] outline-none
                           focus:ring-2 focus:ring-offset-0"
                style={{ background: "var(--bg)", ...border, maxHeight: "10rem" }}
              />

              {imagesAvailable && (
                <button
                  onClick={() => void makePicture()}
                  disabled={busy || !input.trim()}
                  title="Draw this"
                  className="h-11 w-11 shrink-0 rounded-xl border text-base disabled:opacity-50"
                  style={border}
                >
                  🎨
                </button>
              )}
              <button
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                className="h-11 shrink-0 rounded-xl px-5 text-sm font-medium text-white disabled:opacity-50"
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


/** One sidebar entry, with pin / archive / delete controls. */
function ConversationRow({
  convo, current, onNavigate,
}: {
  convo: ConvoSummary;
  current: boolean;
  onNavigate: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded-md pr-1"
      style={{ background: current ? "var(--bg)" : "transparent" }}
    >
      <Link
        href={`/chat/${convo.id}`}
        onClick={onNavigate}
        className="min-w-0 flex-1 truncate px-2 py-2.5 text-sm hover:opacity-80"
        title={convo.title}
      >
        {convo.pinned && <span aria-hidden> 📌 </span>}
        {convo.title}
      </Link>

      {/* Controls stay visible on touch devices, where hover does not exist. */}
      <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100">
        {!convo.archived && (
          <form action={togglePinAction}>
            <input type="hidden" name="id" value={convo.id} />
            <button type="submit" title={convo.pinned ? "Unpin" : "Pin"}
                    aria-label={convo.pinned ? "Unpin chat" : "Pin chat"}
                    className="h-8 w-7 text-xs leading-8 hover:opacity-70">
              {convo.pinned ? "📌" : "📍"}
            </button>
          </form>
        )}

        <form action={toggleArchiveAction}>
          <input type="hidden" name="id" value={convo.id} />
          <button type="submit" title={convo.archived ? "Unarchive" : "Archive"}
                  aria-label={convo.archived ? "Unarchive chat" : "Archive chat"}
                  className="h-8 w-7 text-xs leading-8 hover:opacity-70">
            {convo.archived ? "↩️" : "🗄️"}
          </button>
        </form>

        <form
          action={deleteConversationAction}
          onSubmit={(e) => {
            const forget = e.currentTarget.elements.namedItem("forget") as HTMLInputElement;
            const msg =
              `Delete "${convo.title}" permanently?\n\n` +
              `This cannot be undone. Archiving hides it instead and keeps everything.\n\n` +
              `OK = delete the chat.\n` +
              `Cancel = keep it.`;
            if (!window.confirm(msg)) {
              e.preventDefault();
              return;
            }
            forget.value = window.confirm(
              "Also forget what the assistant learned from this chat?\n\n" +
                "OK = forget it too.\n" +
                "Cancel = keep those memories.",
            )
              ? "true"
              : "false";
          }}
        >
          <input type="hidden" name="id" value={convo.id} />
          <input type="hidden" name="forget" value="false" />
          <button type="submit" title="Delete" aria-label="Delete chat"
                  className="h-8 w-7 text-xs leading-8 hover:opacity-70">
            🗑️
          </button>
        </form>
      </div>
    </div>
  );
}
