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

const SHEET_EXT = ["xlsx", "xlsm", "xltx"];

/**
 * Spreadsheets are chunked row-wise with the header repeated, so a retrieved
 * fragment still says which columns the numbers belong to. Plain prose
 * chunking would strand rows with no header and make them unreadable.
 */
async function extractSheets(buf: Buffer): Promise<string[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object") {
      const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
      if (typeof o.text === "string") return o.text;
      if (o.richText) return o.richText.map((r) => r.text).join("");
      if (o.result !== undefined) return String(o.result); // formula → its value
      return "";
    }
    return String(v);
  };

  const ROWS_PER_CHUNK = 40;
  const out: string[] = [];

  wb.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map(cell);
      if (values.some((v) => v.trim() !== "")) rows.push(values);
    });
    if (rows.length === 0) return;

    const header = rows[0].join(" | ");
    const body = rows.slice(1);
    const label = `Sheet "${sheet.name}"`;

    if (body.length === 0) {
      out.push(`${label}\n${header}`);
      return;
    }

    for (let i = 0; i < body.length; i += ROWS_PER_CHUNK) {
      const slice = body.slice(i, i + ROWS_PER_CHUNK);
      out.push(
        `${label} (rows ${i + 2}-${i + 1 + slice.length} of ${body.length + 1})\n` +
          `${header}\n${slice.map((r) => r.join(" | ")).join("\n")}`,
      );
    }
  });

  if (out.length === 0) throw new Error("That spreadsheet has no readable rows.");
  return out;
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

  if (mime.startsWith("text/") || ["txt", "md", "csv", "tsv", "json", "log"].includes(ext)) {
    return buf.toString("utf8");
  }

  if (ext === "xls") {
    throw new Error(
      "Old .xls files are not supported. Open it in Excel and choose " +
        "Save As → Excel Workbook (.xlsx), then upload that.",
    );
  }

  throw new Error(
    `Unsupported file type: ${mime || ext}. ` +
      "Try PDF, Word (.docx), Excel (.xlsx), CSV, TXT or Markdown.",
  );
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Parses, chunks, embeds and stores a document. Marks status as it goes. */
export async function ingestDocument(documentId: string, buf: Buffer, mime: string, filename: string) {
  try {
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    const parts = SHEET_EXT.includes(ext)
      ? await extractSheets(buf)
      : chunkText(await extractText(buf, mime, filename));

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

export type DocSummary = {
  id: string;
  filename: string;
  createdAt: Date | string;
  chunks: number;
};

/** Everything this user is allowed to see, newest first. */
export async function listDocuments(userId: string, limit = 25): Promise<DocSummary[]> {
  return pg<DocSummary[]>`
    SELECT d.id, d.filename, d.created_at AS "createdAt",
           count(c.id)::int AS chunks
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    WHERE d.status = 'ready' AND (d.shared = true OR d.user_id = ${userId})
    GROUP BY d.id
    ORDER BY d.created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * A manifest of what has been uploaded, always included in the prompt.
 *
 * Without this the model only ever learns a document exists when the question
 * happens to match its contents, so "do you see my files?" answers "no" while
 * the files sit there perfectly indexed.
 */
export function formatManifest(docs: DocSummary[]): string {
  if (!docs.length) {
    return "No documents have been uploaded yet. If the person refers to a file, say none have been uploaded.";
  }
  const list = docs
    .map((d) => {
      // The driver may hand back a string or a Date depending on the column.
      const when = new Date(d.createdAt as unknown as string | Date);
      const day = Number.isNaN(when.getTime()) ? "unknown date" : when.toISOString().slice(0, 10);
      return `- ${d.filename} (uploaded ${day}, ${d.chunks} sections)`;
    })
    .join("\n");
  return (
    `Documents available to you right now — you can read all of them:\n${list}\n\n` +
    `Never claim you cannot see these files, and never say you checked a folder or the filesystem. ` +
    `If a relevant excerpt is not included below, say which file you need and ask the person to be more specific.`
  );
}

/** Questions aimed at the documents themselves rather than their wording. */
const DOC_SCOPED =
  /\b(file|files|spreadsheet|spreadsheets|workbook|document|documents|doc|docs|sheet|sheets|upload|uploaded|attachment|report|tab|column|row|rows|record|records|duplicate|duplicates|repeat|compare|comparison|difference|differences|reconcil\w*|both|each|between)\b/i;

export function isDocumentScoped(text: string): boolean {
  return DOC_SCOPED.test(text);
}

/**
 * Pulls whole documents in, in order, up to a character budget.
 *
 * Similarity search is the wrong tool for "are there duplicate records in
 * each?" — that needs the rows themselves, not the handful that happen to sit
 * near the question in vector space.
 */
export async function chunksForDocuments(
  docIds: string[],
  budget: number,
): Promise<Excerpt[]> {
  if (!docIds.length) return [];

  const rows = await pg<{ content: string; filename: string; idx: number }[]>`
    SELECT c.content, d.filename, c.idx
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.document_id = ANY(${docIds})
    ORDER BY d.created_at DESC, c.idx ASC
  `;

  const out: Excerpt[] = [];
  let used = 0;
  for (const r of rows) {
    if (used + r.content.length > budget) break;
    used += r.content.length;
    out.push({ content: r.content, filename: r.filename, distance: 0 });
  }
  return out;
}

/**
 * A compact structural view: the first chunk of each sheet in each document.
 *
 * Whole-document context is right for a large model, but burying a small one
 * under thousands of rows makes it lose the thread and answer from general
 * knowledge instead. The opening chunk of a sheet carries its header row,
 * which is what structural questions actually need; row-level questions are
 * served by similarity search on top.
 */
export async function documentOverview(
  docIds: string[],
  budget: number,
): Promise<Excerpt[]> {
  if (!docIds.length) return [];

  const rows = await pg<{ content: string; filename: string; idx: number }[]>`
    SELECT c.content, d.filename, c.idx
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.document_id = ANY(${docIds})
    ORDER BY d.created_at DESC, c.idx ASC
  `;

  const seenSheet = new Set<string>();
  const out: Excerpt[] = [];
  let used = 0;

  for (const r of rows) {
    // Chunks are labelled `Sheet "Name" (rows a-b of n)`; group by that name.
    const sheet = /^Sheet "([^"]+)"/.exec(r.content)?.[1] ?? `plain:${r.idx}`;
    const key = `${r.filename}::${sheet}`;
    if (seenSheet.has(key)) continue;
    seenSheet.add(key);

    if (used + r.content.length > budget) continue;
    used += r.content.length;
    out.push({ content: r.content, filename: r.filename, distance: 0 });
  }
  return out;
}
