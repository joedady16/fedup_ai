import "server-only";
import { eq } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { chunks, documents } from "@/db/schema";
import { embed, embedMany } from "./ai/ollama";

const CHUNK = 1200;
const OVERLAP = 150;

/** Splits on paragraph boundaries, falling back to hard cuts for long prose. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const paras = clean.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = "";

  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };

  for (const p of paras) {
    if (p.length > CHUNK) {
      flush();
      for (let i = 0; i < p.length; i += CHUNK - OVERLAP) {
        out.push(p.slice(i, i + CHUNK).trim());
      }
      continue;
    }
    if (cur.length + p.length + 2 > CHUNK) flush();
    cur += (cur ? "\n\n" : "") + p;
  }
  flush();
  return out.filter((c) => c.length > 20);
}

/** Extracts plain text from the formats a family actually uploads. */
export async function extractText(buf: Buffer, mime: string, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (mime === "application/pdf" || ext === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(doc, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }

  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }

  if (mime.startsWith("text/") || ["txt", "md", "csv", "json", "log"].includes(ext)) {
    return buf.toString("utf8");
  }

  throw new Error(`Unsupported file type: ${mime || ext}. Try PDF, DOCX, TXT, MD or CSV.`);
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Parses, chunks, embeds and stores a document. Marks status as it goes. */
export async function ingestDocument(documentId: string, buf: Buffer, mime: string, filename: string) {
  try {
    const text = await extractText(buf, mime, filename);
    const parts = chunkText(text);
    if (parts.length === 0) throw new Error("No readable text found in this file.");

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc) throw new Error("Document row vanished");

    const vectors = await embedMany(parts);
    for (let i = 0; i < parts.length; i++) {
      await pg`
        INSERT INTO chunks (document_id, user_id, shared, idx, content, embedding)
        VALUES (${documentId}, ${doc.userId}, ${doc.shared}, ${i}, ${parts[i]},
                ${toVector(vectors[i])}::vector)
      `;
    }
    await db.update(documents).set({ status: "ready" }).where(eq(documents.id, documentId));
    return parts.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(documents)
      .set({ status: "failed", error: msg })
      .where(eq(documents.id, documentId));
    throw e;
  }
}

export type Excerpt = { content: string; filename: string; distance: number };

/** Nearest chunks the user is allowed to see: their own, plus shared family docs. */
export async function retrieve(userId: string, query: string, k = 6): Promise<Excerpt[]> {
  const vec = toVector(await embed(query));
  const rows = await pg<{ content: string; filename: string; distance: number }[]>`
    SELECT c.content, d.filename, c.embedding <=> ${vec}::vector AS distance
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL AND (c.shared = true OR c.user_id = ${userId})
    ORDER BY c.embedding <=> ${vec}::vector
    LIMIT ${k}
  `;
  // Cosine distance > ~0.6 means the chunk is not really about the question.
  return rows.filter((r) => r.distance < 0.6);
}

export function formatExcerpts(items: Excerpt[]): string {
  if (!items.length) return "";
  const body = items
    .map((e, i) => `[${i + 1}] from "${e.filename}":\n${e.content}`)
    .join("\n\n---\n\n");
  return `Relevant excerpts from the family's documents:\n\n${body}`;
}
