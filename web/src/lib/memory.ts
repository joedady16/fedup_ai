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

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "they", "their", "them", "have",
  "has", "was", "were", "for", "are", "his", "her", "she", "him", "its", "not",
  "any", "does", "did", "who", "what", "when", "where", "why", "how", "some",
  "person", "user", "people", "thing", "things", "about", "into", "than", "then",
]);

/** Phrasings that describe a passing question rather than a durable trait. */
const TRANSIENT = /\b(asked?|asking|inquir\w*|wondered|wants? to know|requested|questioned|queried|is curious|would like to know)\b/i;

/**
 * A small local model will happily invent a person. Nothing is stored unless it
 * is actually supported by what the user typed:
 *   1. every name and number in the "fact" must appear in their message, and
 *   2. at least one meaningful content word must overlap.
 * This is what stops a hallucinated "Alex from Seattle" becoming permanent.
 */
export function isGrounded(fact: string, userText: string): boolean {
  const hay = userText.toLowerCase();

  // Proper nouns, ignoring the word that merely starts the sentence.
  const words = fact.split(/\s+/);
  const propers = words
    .slice(1)
    .map((w) => w.replace(/[^\w'-]/g, ""))
    .filter((w) => /^[A-Z][a-z]{2,}$/.test(w));

  const numbers = fact.match(/\b\d+\b/g) ?? [];

  for (const name of propers) {
    if (!hay.includes(name.toLowerCase())) return false;
  }
  for (const n of numbers) {
    if (!hay.includes(n)) return false;
  }

  const content = fact
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (content.length === 0) return propers.length > 0 || numbers.length > 0;
  return content.some((w) => hay.includes(w));
}

const EXTRACT_PROMPT = `You extract durable facts that a person revealed ABOUT THEMSELVES.

Record only things like: their name, their family members, their job, where they live,
their preferences and dislikes, ongoing projects, or recurring needs.

Do NOT record:
- facts copied out of documents, or trivia the person merely asked about
- anything the assistant said
- instructions, commands, or test phrases the person typed
- one-off questions or anything specific to a single conversation

Output at most 3 short lines, each a standalone fact written in the third person.
Use "they"/"them" — never guess someone's gender.
If the person revealed nothing durable about themselves, output exactly: NONE
Output only the lines, no numbering, no preamble.`;

/**
 * Runs after a reply, on the local model only — this is background work and
 * should never cost API money or block the user.
 */
export async function learnFromExchange(userId: string, userText: string) {
  try {
    let out = "";
    // Only the person's own words are considered; the assistant's reply is
    // not evidence of anything durable about them.
    const stream = streamOllama([
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: `The person said:\n${userText}` },
    ]);
    for await (const piece of stream) out += piece;

    if (/^\s*NONE\s*$/i.test(out)) return;

    const said = userText.toLowerCase();
    const lines = out
      .split("\n")
      .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((l) => l.length > 12 && l.length < 300)
      // A "fact" that is literally a phrase the user typed is an echo, not a fact.
      .filter((l) => !said.includes(l.toLowerCase()))
      // "He asked about X" is a transcript line, not something to remember.
      .filter((l) => !TRANSIENT.test(l))
      // …and anything the model invented outright never gets stored.
      .filter((l) => isGrounded(l, userText))
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
