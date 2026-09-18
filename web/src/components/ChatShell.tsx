"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  logoutAction, togglePinAction, toggleArchiveAction, deleteConversationAction,
  renameConversationAction,
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
  const pathname = usePathname();
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

  /**
   * Starting a new chat cannot rely on navigation alone: after the first
   * message the URL is still /chat, so a link to /chat goes nowhere and the
   * previous conversation stays on screen. Clear the state ourselves.
   */
  function startNewChat() {
    setMessages([]);
    setConvId(null);
    setInput("");
    setError(null);
    setSidebarOpen(false);
    if (pathname !== "/chat") router.push("/chat");
    else window.history.replaceState(null, "", "/chat");
  }

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
            // Shallow URL update: keeps the address bar honest (and the back
            // button useful) without re-rendering and killing the stream.
            if (!conversationId) {
              window.history.replaceState(null, "", `/chat/${ev.conversationId}`);
            }
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

  const MAX_FILES = 10;

  /**
   * Sends the whole batch in one request and follows the server's progress
   * stream. One request means the server can write a single summary into the
   * conversation, so uploads survive a page reload.
   */
  async function uploadMany(files: File[]) {
    setError(null);
    setBusy(true);

    const batch = files.slice(0, MAX_FILES);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content:
          batch.length === 1
            ? `Reading "${batch[0].name}"…`
            : `Reading ${batch.length} files…`,
        pending: true,
      },
    ]);

    try {
      const fd = new FormData();
      for (const f of batch) fd.append("file", f);
      if (convId) fd.append("conversationId", convId);

      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: "Upload failed." }));
        throw new Error(j.error ?? "Upload failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;

          const ev = JSON.parse(raw) as {
            type: string;
            index?: number;
            total?: number;
            name?: string;
            summary?: string;
            conversationId?: string | null;
          };

          if (ev.type === "progress") {
            const label =
              ev.total === 1
                ? `Reading "${ev.name}"…`
                : `Reading ${(ev.index ?? 0) + 1} of ${ev.total}: "${ev.name}"…`;
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = { role: "assistant", content: label, pending: true };
              return next;
            });
          } else if (ev.type === "done") {
            if (ev.conversationId && !convId) {
              setConvId(ev.conversationId);
              window.history.replaceState(null, "", `/chat/${ev.conversationId}`);
            }
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = {
                role: "assistant",
                content: ev.summary || "Nothing was uploaded.",
              };
              return next;
            });
          }
        }
      }

      // A brand-new chat now has a conversation row; refresh the sidebar.
      router.refresh();
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
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            New chat
          </button>
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
                accept=".pdf,.docx,.xlsx,.xlsm,.xltx,.csv,.tsv,.txt,.md,.json,.log"
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length) void uploadMany(picked);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title="Upload documents (you can pick several)"
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


/** One sidebar entry, with rename / pin / archive / delete controls. */
function ConversationRow({
  convo, current, onNavigate,
}: {
  convo: ConvoSummary;
  current: boolean;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState(convo.title);
  const [draft, setDraft] = useState(convo.title);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter saves and then the input blurs; this stops the blur saving twice.
  const settled = useRef(false);

  // Pick up renames made elsewhere (another tab, a refresh).
  useEffect(() => {
    if (!editing) setTitle(convo.title);
  }, [convo.title, editing]);

  useEffect(() => {
    if (editing) {
      settled.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    setDraft(title);
    setEditing(true);
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
  }

  function save() {
    if (settled.current) return;
    settled.current = true;

    const next = draft.trim().slice(0, 120);
    setEditing(false);
    if (!next || next === title) return;

    const previous = title;
    setTitle(next); // show it immediately rather than waiting on the server

    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", convo.id);
      fd.set("title", next);
      try {
        await renameConversationAction(fd);
        router.refresh();
      } catch {
        setTitle(previous); // put it back if the save failed
      }
    });
  }

  return (
    <div
      className="conv-row group relative flex items-center gap-1 rounded-md"
      style={{ background: current ? "var(--bg)" : "transparent" }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={120}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={save}
          className="min-w-0 flex-1 rounded-md border px-2 py-2 text-sm"
          style={{ background: "var(--bg)", borderColor: "var(--accent)" }}
        />
      ) : (
        <Link
          href={`/chat/${convo.id}`}
          onClick={onNavigate}
          onDoubleClick={(e) => {
            e.preventDefault();
            startEditing();
          }}
          className="min-w-0 flex-1 truncate py-2.5 pl-2 pr-1 text-sm hover:opacity-80"
          title={`${title} — double-click to rename`}
        >
          {convo.pinned && <span aria-hidden> 📌 </span>}
          {title}
        </Link>
      )}

      {!editing && (
        <>
          {/* Pointer devices: a compact cluster that overlays the end of the
              title only on hover or keyboard focus, so titles get full width. */}
          <div className="row-actions-hover absolute inset-y-0 right-1 items-center rounded-md pl-4"
               style={{
                 background: `linear-gradient(to right, transparent, ${
                   current ? "var(--bg)" : "var(--panel)"} 1rem)`,
               }}>
            <IconButton label="Rename chat" onClick={startEditing}>✏️</IconButton>
            {!convo.archived && (
              <form action={togglePinAction}>
                <input type="hidden" name="id" value={convo.id} />
                <IconButton label={convo.pinned ? "Unpin chat" : "Pin chat"} submit>
                  {convo.pinned ? "📌" : "📍"}
                </IconButton>
              </form>
            )}
            <form action={toggleArchiveAction}>
              <input type="hidden" name="id" value={convo.id} />
              <IconButton label={convo.archived ? "Unarchive chat" : "Archive chat"} submit>
                {convo.archived ? "↩️" : "🗄️"}
              </IconButton>
            </form>
            <form action={deleteConversationAction} onSubmit={(e) => confirmDelete(e, title)}>
              <input type="hidden" name="id" value={convo.id} />
              <input type="hidden" name="forget" value="false" />
              <IconButton label="Delete chat" submit>🗑️</IconButton>
            </form>
          </div>

          {/* Touch devices: one ⋯ button opening a labelled menu, since emoji
              on their own are hard to tell apart at thumb size. */}
          <div className="row-actions-touch relative shrink-0">
            <button
              type="button"
              aria-label="Chat options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="h-9 w-9 rounded-md text-base leading-none"
              style={{ color: "var(--muted)" }}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute right-0 top-10 z-40 w-44 overflow-hidden rounded-xl border py-1 text-sm shadow-lg"
                  style={{ background: "var(--panel)", borderColor: "var(--border)" }}
                >
                  <MenuItem onClick={() => { setMenuOpen(false); startEditing(); }}>✏️  Rename</MenuItem>
                  {!convo.archived && (
                    <form action={togglePinAction}>
                      <input type="hidden" name="id" value={convo.id} />
                      <MenuItem submit>{convo.pinned ? "📌  Unpin" : "📍  Pin"}</MenuItem>
                    </form>
                  )}
                  <form action={toggleArchiveAction}>
                    <input type="hidden" name="id" value={convo.id} />
                    <MenuItem submit>{convo.archived ? "↩️  Unarchive" : "🗄️  Archive"}</MenuItem>
                  </form>
                  <form action={deleteConversationAction} onSubmit={(e) => confirmDelete(e, title)}>
                    <input type="hidden" name="id" value={convo.id} />
                    <input type="hidden" name="forget" value="false" />
                    <MenuItem submit danger>🗑️  Delete</MenuItem>
                  </form>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function confirmDelete(e: React.FormEvent<HTMLFormElement>, title: string) {
  const forget = e.currentTarget.elements.namedItem("forget") as HTMLInputElement;
  if (
    !window.confirm(
      `Delete "${title}" permanently?\n\n` +
        "This cannot be undone. Archiving hides it instead and keeps everything.",
    )
  ) {
    e.preventDefault();
    return;
  }
  forget.value = window.confirm(
    "Also forget what the assistant learned from this chat?\n\n" +
      "OK = forget it too.\nCancel = keep those memories.",
  )
    ? "true"
    : "false";
}

function IconButton({
  label, children, onClick, submit,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  submit?: boolean;
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      onClick={onClick}
      title={label.replace(/ chat$/, "")}
      aria-label={label}
      className="h-8 w-7 text-xs leading-8 opacity-70 hover:opacity-100"
    >
      {children}
    </button>
  );
}

function MenuItem({
  children, onClick, submit, danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  submit?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-2.5 text-left hover:opacity-70"
      style={danger ? { color: "#dc2626" } : undefined}
    >
      {children}
    </button>
  );
}
