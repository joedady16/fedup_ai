import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { ingestDocument } from "@/lib/rag";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UPLOADS = process.env.UPLOADS_DIR ?? "/app/uploads";
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const rows = await db
    .select()
    .from(documents)
    .where(or(eq(documents.shared, true), eq(documents.userId, user.id)))
    .orderBy(desc(documents.createdAt));

  return NextResponse.json({ documents: rows });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 25MB" }, { status: 413 });
  }

  const shared = form.get("shared") !== "false";
  const buf = Buffer.from(await file.arrayBuffer());

  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120);
  const storagePath = path.join(UPLOADS, `${randomUUID()}-${safeName}`);
  await mkdir(UPLOADS, { recursive: true });
  await writeFile(storagePath, buf);

  const [doc] = await db
    .insert(documents)
    .values({
      userId: user.id,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath,
      shared,
    })
    .returning();

  try {
    const count = await ingestDocument(doc.id, buf, doc.mime, doc.filename);
    return NextResponse.json({ document: { ...doc, status: "ready" }, chunks: count });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read that file.";
    return NextResponse.json({ document: doc, error: message }, { status: 422 });
  }
}
