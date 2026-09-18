import "server-only";

const BASE = process.env.OLLAMA_URL ?? "http://host.docker.internal:11434";
export const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "gemma3:latest";
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? "llava:latest";
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

/**
 * Ollama defaults to a small context window regardless of what the model
 * supports, and silently drops the FRONT of an over-long prompt — which is
 * exactly where the system prompt and document excerpts live. Without this,
 * the model answers from memory and looks like it is ignoring your files.
 */
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 16384);

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Streams assistant text deltas from a local Ollama model. */
export async function* streamOllama(
  messages: ChatMessage[],
  model = CHAT_MODEL,
): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { num_ctx: NUM_CTX },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Ollama emits newline-delimited JSON objects.
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };
        if (obj.error) throw new Error(obj.error);
        const piece = obj.message?.content;
        if (piece) yield piece;
      } catch (e) {
        if (e instanceof SyntaxError) continue; // partial line, wait for more
        throw e;
      }
    }
  }
}

/** Embeds text. Falls back to the legacy endpoint on older Ollama builds. */
export async function embed(input: string): Promise<number[]> {
  const res = await fetch(`${BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });

  if (res.ok) {
    const j = (await res.json()) as { embeddings?: number[][] };
    if (j.embeddings?.[0]) return j.embeddings[0];
  }

  const legacy = await fetch(`${BASE}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
  });
  if (!legacy.ok) {
    throw new Error(
      `Embedding failed (${legacy.status}). Is "${EMBED_MODEL}" pulled? Run: ollama pull ${EMBED_MODEL}`,
    );
  }
  const j = (await legacy.json()) as { embedding: number[] };
  return j.embedding;
}

export async function embedMany(inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of inputs) out.push(await embed(t)); // serial: 8GB card, one at a time
  return out;
}

/** Describes an image using the local vision model. */
export async function describeImage(base64: string, prompt: string): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      stream: false,
      options: { num_ctx: NUM_CTX },
      messages: [{ role: "user", content: prompt, images: [base64] }],
    }),
  });
  if (!res.ok) throw new Error(`Vision model failed: ${res.status}`);
  const j = (await res.json()) as { message?: { content?: string } };
  return j.message?.content ?? "";
}

type LoadedModel = { name: string };

/**
 * Asks Ollama to drop its resident models so the image model can have the GPU.
 * On an 8GB card the chat model and SDXL cannot both stay loaded; setting
 * keep_alive to 0 evicts immediately. Best-effort — never blocks the caller.
 */
export async function unloadModels(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const { models = [] } = (await res.json()) as { models?: LoadedModel[] };

    const freed: string[] = [];
    for (const m of models) {
      const ok = await fetch(`${BASE}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: AbortSignal.timeout(15_000),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) freed.push(m.name);
    }
    return freed;
  } catch {
    return [];
  }
}
