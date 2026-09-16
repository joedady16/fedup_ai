import "server-only";
import { streamOllama, CHAT_MODEL, type ChatMessage } from "./ollama";
import { streamAnthropic, SMART_MODEL, smartModeAvailable } from "./anthropic";

export type Mode = "local" | "smart";

export function resolveMode(requested: Mode): { mode: Mode; model: string } {
  if (requested === "smart" && smartModeAvailable()) {
    return { mode: "smart", model: SMART_MODEL };
  }
  return { mode: "local", model: CHAT_MODEL };
}

/** Single entry point the chat route uses, regardless of backend. */
export function streamChat(
  mode: Mode,
  messages: ChatMessage[],
  system: string,
): AsyncGenerator<string> {
  if (mode === "smart") return streamAnthropic(messages, system);
  return streamOllama([{ role: "system", content: system }, ...messages]);
}

export { smartModeAvailable };
export type { ChatMessage };
