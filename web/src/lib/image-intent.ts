import "server-only";

/**
 * Detects "make me a picture of X" in ordinary chat.
 *
 * People ask for images conversationally rather than reaching for a button, so
 * the chat route checks here first. Kept deliberately conservative: a false
 * positive spends GPU time and returns a picture nobody wanted.
 */
const VERB = String.raw`(?:draw|sketch|paint|generate|create|make|render|design|show\s+me|give\s+me|i\s+want|can\s+you\s+(?:draw|make|create|generate|show))`;
const NOUN = String.raw`(?:picture|image|photo|drawing|sketch|painting|illustration|diagram|artwork|art|logo|poster|wallpaper|portrait|render)`;

const PATTERNS: RegExp[] = [
  // "draw a picture of a fox", "can you make an image of…"
  new RegExp(String.raw`^\s*${VERB}\b[^.?!]{0,40}?\b(?:a|an|some|me)?\s*${NOUN}\b`, "i"),
  // "a picture of a fox, please"
  new RegExp(String.raw`^\s*(?:a|an)\s+${NOUN}\s+of\b`, "i"),
  // bare imperative: "draw a red fox"
  new RegExp(String.raw`^\s*(?:draw|sketch|paint|illustrate)\s+(?:me\s+)?(?:a|an|the)\b`, "i"),
];

/** Phrases that mention a picture but are not a request to make one. */
const NOT_A_REQUEST =
  /\b(?:in the (?:picture|image|photo)|this (?:picture|image|photo)|the attached|uploaded|describe the|what(?:'s| is) in)\b/i;

export function looksLikeImageRequest(text: string): boolean {
  const t = text.trim();
  if (t.length > 300) return false;        // long prose is a question, not a prompt
  if (NOT_A_REQUEST.test(t)) return false;
  return PATTERNS.some((re) => re.test(t));
}

/**
 * Strips the request wrapper so the diffusion model receives the subject
 * rather than "can you draw me a picture of".
 */
export function extractImagePrompt(text: string): string {
  let t = text.trim().replace(/[?!]+$/, "");

  t = t.replace(
    new RegExp(String.raw`^\s*(?:hey\s+|please\s+)?(?:can\s+you\s+|could\s+you\s+|i\s+want\s+|i'?d\s+like\s+)?${VERB}\b`, "i"),
    "",
  );
  t = t.replace(/^\s*me\b\s*/i, "");
  // Only drop the noun when a connector follows it ("a picture OF a fox").
  // Without this, "a logo for my consultancy" loses the very thing being asked for.
  t = t.replace(
    new RegExp(String.raw`^\s*(?:a|an|the|some)?\s*${NOUN}\s+(?:of|showing|with|depicting)\b`, "i"),
    "",
  );
  t = t.replace(/^\s*(?:of|that|which|showing)\b/i, "");
  t = t.replace(/\b(?:please|thanks|thank you)\b\.?\s*$/i, "");
  t = t.replace(/^[\s,:-]+|[\s,]+$/g, "");

  // If stripping removed everything meaningful, fall back to the original.
  return t.length >= 3 ? t : text.trim();
}
