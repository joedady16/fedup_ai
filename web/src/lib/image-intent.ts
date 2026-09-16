import "server-only";

/**
 * Detects "make me a picture of X" in ordinary chat.
 *
 * People ask for images conversationally rather than reaching for a button, so
 * the chat route checks here first. Kept deliberately conservative: a false
 * positive spends GPU time and returns a picture nobody wanted.
 */
const VERB = String.raw`(?:draw|sketch|paint|generate|create|make|render|design|produce|whip\s+up|cook\s+up|knock\s+up|put\s+together|shoot|send|show|give|get|find|grab|hook\s+me\s+up\s+with|i\s+want|i\s+need|i'?d\s+like|let'?s\s+see|gimme|can\s+you|could\s+you|please)`;
const NOUN = String.raw`(?:picture|pic|image|photo|photograph|drawing|sketch|painting|illustration|diagram|artwork|art|logo|poster|wallpaper|portrait|render|visual)`;

const PATTERNS: RegExp[] = [
  // The strongest and most verb-agnostic signal: "... a picture OF <thing>".
  // This is what catches phrasings no verb list would ever cover —
  // "shoot me a picture of", "hook me up with an image of", and so on.
  new RegExp(String.raw`\b(?:a|an|some)\s+${NOUN}\s+(?:of|showing|depicting|with)\b`, "i"),
  // "picture of a fox" with no article at all.
  new RegExp(String.raw`^\s*${NOUN}\s+of\b`, "i"),
  // Verb followed by the noun: "generate a logo", "make me a poster".
  new RegExp(String.raw`^\s*${VERB}\b[^.?!]{0,40}?\b(?:a|an|some|me)?\s*${NOUN}\b`, "i"),
  // Bare imperative: "draw a red fox".
  new RegExp(String.raw`^\s*(?:draw|sketch|paint|illustrate)\s+(?:me\s+)?(?:a|an|the)\b`, "i"),
];

/** Phrases that mention a picture but are not a request to make one. */
const NOT_A_REQUEST =
  /\b(?:in the (?:picture|image|photo)|this (?:picture|image|photo)|the attached|uploaded|describe the|what(?:'s| is) in|didn'?t|did not|never (?:generated|made|drew)|couldn'?t|can'?t you|why (?:is|did|didn)|not seeing|no picture)\b/i;

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

  // Strip any leading request wrapper, however it was phrased.
  t = t.replace(
    new RegExp(String.raw`^\s*(?:hey\s+|ok(?:ay)?\s+|so\s+|please\s+)*(?:${VERB}\s*){1,3}`, "i"),
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
