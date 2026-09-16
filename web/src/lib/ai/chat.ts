import "server-only";
import { streamOllama, CHAT_MODEL, type ChatMessage } from "./ollama";
import {
  streamAnthropic, SMART_MODEL, smartModeAvailable, webAccessAvailable,
  type StreamEvent,
} from "./anthropic";

export type Mode = "local" | "smart";

export function resolveMode(requested: Mode): { mode: Mode; model: string } {
  if (requested === "smart" && smartModeAvailable()) {
    return { mode: "smart", model: SMART_MODEL };
  }
  return { mode: "local", model: CHAT_MODEL };
}

/** Wraps the local model's plain text deltas in the shared event shape. */
async function* localEvents(
  messages: ChatMessage[],
  system: string,
): AsyncGenerator<StreamEvent> {
  for await (const text of streamOllama([{ role: "system", content: system }, ...messages])) {
    yield { type: "text", text };
  }
}

/** Single entry point the chat route uses, regardless of backend. */
export function streamChat(
  mode: Mode,
  messages: ChatMessage[],
  system: string,
  opts: { web?: boolean } = {},
): AsyncGenerator<StreamEvent> {
  if (mode === "smart") return streamAnthropic(messages, system, opts);
  return localEvents(messages, system);
}

export { smartModeAvailable, webAccessAvailable };
export type { ChatMessage, StreamEvent };
