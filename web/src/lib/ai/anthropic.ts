import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./ollama";

export const SMART_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/** Smart mode is only offered when a key is configured. */
export const smartModeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Web access rides on smart mode — the local model has no search backend. */
export const webAccessAvailable = () =>
  smartModeAvailable() && (process.env.WEB_ACCESS ?? "true") !== "false";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — smart mode is unavailable.");
  }
  client ??= new Anthropic();
  return client;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "sources"; urls: { url: string; title?: string }[] };

/**
 * Anthropic's server-side web tools. These run on Anthropic's infrastructure,
 * so there is no tool loop to execute here — results come back as content
 * blocks in the same response.
 *
 * Note: web_fetch only retrieves URLs already present in the conversation, so
 * search is what finds new pages and fetch is what reads one the user pasted.
 */
function webTools() {
  return [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 6 },
    {
      type: "web_fetch_20260209" as const,
      name: "web_fetch" as const,
      max_uses: 6,
      citations: { enabled: true },
    },
  ];
}

const MAX_RESUMES = 4;

/**
 * Streams assistant text from Claude, optionally with live web access.
 *
 * Thinking stays at its default (adaptive on Opus 5) with effort tuned down a
 * notch, which keeps a family chat responsive without the failure modes that
 * come from disabling thinking outright.
 */
export async function* streamAnthropic(
  messages: ChatMessage[],
  system: string,
  opts: { web?: boolean } = {},
): AsyncGenerator<StreamEvent> {
  const convo: Anthropic.MessageParam[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const useWeb = opts.web === true && webAccessAvailable();
  const seen = new Map<string, string>();
  let announcedSearch = false;

  for (let round = 0; ; round++) {
    const stream = getClient().messages.stream({
      model: SMART_MODEL,
      max_tokens: 64000,
      system,
      output_config: { effort: "medium" },
      ...(useWeb ? { tools: webTools() } : {}),
      messages: convo,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "server_tool_use" &&
        !announcedSearch
      ) {
        announcedSearch = true;
        yield { type: "status", text: "Searching the web…" };
      }

      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();

    // Collect the pages actually consulted, so the answer can cite them.
    for (const block of final.content) {
      if (block.type === "web_search_tool_result") {
        // On failure `content` is a single error object, not a list.
        const results = block.content;
        if (Array.isArray(results)) {
          for (const r of results) {
            if (r.type === "web_search_result") seen.set(r.url, r.title ?? r.url);
          }
        }
      }
    }

    if (final.stop_reason === "refusal") {
      yield { type: "text", text: "\n\n_(Claude declined to answer that one.)_" };
      break;
    }

    // The server-side tool loop hit its iteration cap. Re-send with the paused
    // assistant turn appended and the server picks up where it left off — the
    // SDK does not do this for us, and without it the answer just stops early.
    if (final.stop_reason === "pause_turn" && round < MAX_RESUMES) {
      convo.push({ role: "assistant", content: final.content });
      continue;
    }
    break;
  }

  if (seen.size > 0) {
    yield {
      type: "sources",
      urls: [...seen].map(([url, title]) => ({ url, title })),
    };
  }
}
