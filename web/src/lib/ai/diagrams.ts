import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { streamChat, type Mode } from "./chat";
import {
  DIAGRAM_SYSTEM_PROMPT, extractSvg, isRenderableSvg, sanitizeSvg, svgParseError,
} from "../diagram";
import { IMAGES_DIR } from "./images";

/**
 * Asks the language model for an SVG diagram, sanitises it and stores it
 * alongside generated images. Returns the public URL.
 */
async function attempt(subject: string, mode: Mode, note: string): Promise<string | null> {
  let raw = "";
  for await (const piece of streamChat(
    mode,
    [{ role: "user", content: `Draw this as a diagram: ${subject}${note}` }],
    DIAGRAM_SYSTEM_PROMPT,
  )) {
    raw += piece;
    if (raw.length > 500_000) break; // runaway guard
  }

  const found = extractSvg(raw);
  if (!found) return null;

  const svg = sanitizeSvg(found);
  if (!isRenderableSvg(svg)) {
    console.warn(`[fedup] diagram rejected: ${svgParseError(svg) ?? "not renderable"}`);
    return null;
  }
  return svg;
}

export async function generateDiagram(subject: string, mode: Mode): Promise<string> {
  // Smaller models often emit unbalanced tags on the first go, so give it a
  // second attempt with an explicit nudge before failing.
  let svg = await attempt(subject, mode, "");
  if (!svg) {
    svg = await attempt(
      subject,
      mode,
      "\n\nIMPORTANT: your last attempt was not valid XML. Close every tag exactly once and output only the SVG.",
    );
  }
  if (!svg) {
    throw new Error(
      "Couldn't produce a valid diagram with the local model. Tick smart mode — Claude is much better at this.",
    );
  }

  const name = `${randomUUID()}.svg`;
  await mkdir(IMAGES_DIR, { recursive: true });
  await writeFile(path.join(IMAGES_DIR, name), svg, "utf8");
  return `/generated/${name}`;
}
