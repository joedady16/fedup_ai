import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./ollama";

export const SMART_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/** Smart mode is only offered when a key is configured. */
export const smartModeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — smart mode is unavailable.");
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Streams assistant text from Claude. Thinking is left at its default
 * (adaptive on Opus 5) and effort is tuned down a notch, which keeps a family
 * chat responsive without the failure modes that come from disabling thinking.
 */
export async function* streamAnthropic(
  messages: ChatMessage[],
  system: string,
): AsyncGenerator<string> {
  const convo = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const stream = getClient().messages.stream({
    model: SMART_MODEL,
    max_tokens: 64000,
    system,
    output_config: { effort: "medium" },
    messages: convo,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "\n\n_(Claude declined to answer that one.)_";
  }
}
