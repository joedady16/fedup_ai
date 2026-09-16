import "server-only";
import { XMLValidator } from "fast-xml-parser";

/**
 * Diagrams are structured drawing, not painting: positions, arrows and labels.
 * Diffusion models are bad at exactly that, so these requests go to the
 * language model and come back as SVG.
 */
const DIAGRAM_NOUN = String.raw`(?:diagram|schematic|chart|flow\s?chart|flow|graph|play|formation|layout|floor\s?plan|blueprint|wireframe|timeline|org\s?chart|mind\s?map|seating|family\s?tree|tree)`;
const ASK = String.raw`(?:draw|sketch|make|create|generate|show\s+me|give\s+me|design|map\s+out|chart|diagram|i\s+want|can\s+you\s+(?:draw|make|create|show|diagram))`;

const PATTERNS: RegExp[] = [
  new RegExp(String.raw`^\s*${ASK}\b[^.?!]{0,60}?\b${DIAGRAM_NOUN}\b`, "i"),
  new RegExp(String.raw`^\s*(?:a|an|the)\s+${DIAGRAM_NOUN}\s+(?:of|for|showing)\b`, "i"),
  // "... as a diagram", "... in a flowchart"
  new RegExp(String.raw`\b(?:as|in|into)\s+(?:a|an)\s+${DIAGRAM_NOUN}\b`, "i"),
];

export function looksLikeDiagramRequest(text: string): boolean {
  const t = text.trim();
  if (t.length > 400) return false;
  return PATTERNS.some((re) => re.test(t));
}

export const DIAGRAM_SYSTEM_PROMPT =
  `You produce diagrams as a single standalone SVG document.

Rules:
- Reply with ONLY the SVG. No prose, no markdown fences, no explanation.
- Start with <svg and end with </svg>.
- Include width, height and a viewBox. Use a 800x600 viewBox unless the subject needs another shape.
- Never include <script>, <foreignObject>, <image>, external URLs, or event attributes (onclick etc).
- Draw a white or very light background rect first so it is readable on any theme.
- Use clear labels with <text>. Keep font-size at 14 or larger.
- Use <defs><marker> for arrowheads when you need directional arrows.
- Use dark strokes (#1f2937) and a restrained palette; make it legible, not decorative.

For a sports play: draw the field markings, use O for offensive players, X for
defenders, solid lines for runs/blocks and dashed lines for motion or routes,
and label each position (QB, RB, WR, TE, LT ...). Show the direction of play
with arrowheads.`;

/** Pulls the SVG out of a model reply that may have wrapped it in prose or fences. */
export function extractSvg(raw: string): string | null {
  const text = raw.replace(/```(?:svg|xml|html)?/gi, "").trim();
  const start = text.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (end === -1 || end < start) return null;
  return text.slice(start, end + "</svg>".length);
}

/**
 * Strips anything active from model-authored SVG.
 *
 * This is defence in depth, not the only defence: the file is served with a
 * locked-down CSP and rendered through an <img> tag, which does not execute
 * scripts in any current browser. Regex sanitising alone would not be enough.
 */
export function sanitizeSvg(svg: string): string {
  let out = svg;

  // Elements that can execute or fetch.
  out = out.replace(
    /<\s*(script|foreignObject|iframe|object|embed|link|style|animate|set|handler)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );
  out = out.replace(
    /<\s*(script|foreignObject|iframe|object|embed|link|animate|set|handler)\b[^>]*\/?>/gi,
    "",
  );

  // Inline event handlers: onclick, onload, onmouseover, …
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // Script-bearing or remote URLs in any attribute.
  out = out.replace(/(href|xlink:href|src)\s*=\s*"(?!#)[^"]*"/gi, "");
  out = out.replace(/(href|xlink:href|src)\s*=\s*'(?!#)[^']*'/gi, "");
  out = out.replace(/javascript\s*:/gi, "");
  out = out.replace(/<!ENTITY[\s\S]*?>/gi, "");
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  return out.trim();
}

/**
 * Checks the SVG will actually render.
 *
 * A start/end tag check is not enough: a smaller model will happily emit
 * unbalanced tags that look fine at both ends, which the browser then shows as
 * a broken image. This parses the document properly.
 */
export function isRenderableSvg(svg: string): boolean {
  if (!/^<svg[\s>]/i.test(svg)) return false;
  if (!/<\/svg>\s*$/i.test(svg)) return false;
  if (svg.length < 60 || svg.length > 400_000) return false;
  // Must actually draw something.
  if (!/<(rect|circle|ellipse|line|path|polygon|polyline|text|g)\b/i.test(svg)) return false;
  return XMLValidator.validate(svg) === true;
}

/** Describes why an SVG failed to parse, for logging. */
export function svgParseError(svg: string): string | null {
  const res = XMLValidator.validate(svg);
  if (res === true) return null;
  const e = res.err;
  return `${e.msg} (line ${e.line}, col ${e.col})`;
}
