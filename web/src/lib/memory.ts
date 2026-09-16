import "server-only";
import { sql as pg } from "@/db";
import { embed } from "./ai/ollama";
import { streamOllama } from "./ai/ollama";

const toVector = (v: number[]) => `[${v.join(",")}]`;

/**
 * Retrieval-based learning: we store durable facts and replay the relevant
 * ones into the system prompt. The model's weights are never changed.
 */
export async function recallMemories(userId: string, query: string, k = 5): Promise<string[]> {
  const vec = toVector(await embed(query));
  const rows = await pg<{ content: string; distance: number }[]>`
    SELECT content, embedding <=> ${vec}::vector AS distance
    FROM memories
    WHERE user_id = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `;
  return rows.filter((r) => r.distance < 0.65).map((r) => r.content);
}

export async function addMemory(userId: string, content: string, kind = "fact") {
  const trimmed = content.trim();
  if (trimmed.length < 4) return;

  // Skip near-duplicates so the same fact doesn't pile up over months.
  const vec = toVector(await embed(trimmed));
  const [dupe] = await pg<{ id: string }[]>`
    SELECT id FROM memories
    WHERE user_id = ${userId} AND embedding IS NOT NULL
      AND embedding <=> ${vec}::vector < 0.08
    LIMIT 1
  `;
  if (dupe) return;

  await pg`
    INSERT INTO memories (user_id, content, kind, embedding)
    VALUES (${userId}, ${trimmed}, ${kind}, ${vec}::vector)
  `;
}

const EXTRACT_PROMPT = `You extract durable facts about a user from a conversation.
Output at most 3 short lines, each a single standalone fact worth remembering long term
(their name, family, job, preferences, ongoing projects, recurring needs).
Ignore anything transient, trivial, or specific to one question.
If there is nothing worth remembering, output exactly: NONE
Output only the lines, no numbering, no preamble.`;

/**
 * Runs after a reply, on the local model only — this is background work and
 * should never cost API money or block the user.
 */
export async function learnFromExchange(userId: string, userText: string, assistantText: string) {
  try {
    let out = "";
    const stream = streamOllama([
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: `User said:\n${userText}\n\nAssistant replied:\n${assistantText}` },
    ]);
    for await (const piece of stream) out += piece;

    if (/^\s*NONE\s*$/i.test(out)) return;

    const lines = out
      .split("\n")
      .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((l) => l.length > 6 && l.length < 300)
      .slice(0, 3);

    for (const line of lines) await addMemory(userId, line);
  } catch {
    // Learning is best-effort; a failure here must not break the chat.
  }
}

export function formatMemories(items: string[]): string {
  if (!items.length) return "";
  return `What you remember about this person:\n${items.map((m) => `- ${m}`).join("\n")}`;
}
