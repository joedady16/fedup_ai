import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, documents, messages } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { ingestDocument } from "@/lib/rag";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOADS = process.env.UPLOADS_DIR ?? "/app/uploads";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

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

const line = (o: unknown) => new TextEncoder().encode(JSON.stringify(o) + "\n");

/**
 * Accepts one or more files and streams progress as it works.
 *
 * Handling the whole batch in a single request means the summary can be
 * written into the conversation once, so uploads survive a reload instead of
 * living only in the browser's memory.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const picked = form.getAll("file").filter((f): f is File => f instanceof File);
  if (picked.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const batch = picked.slice(0, MAX_FILES);
  const skipped = picked.length - batch.length;

  // Only attach to a conversation the requester actually owns.
  let convId: string | null = null;
  const requestedConv = String(form.get("conversationId") ?? "");
  if (requestedConv) {
    const [owned] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, requestedConv), eq(conversations.userId, user.id)))
      .limit(1);
    convId = owned?.id ?? null;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const done: { name: string; chunks: number }[] = [];
      const failed: { name: string; why: string }[] = [];

      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        controller.enqueue(line({ type: "progress", index: i, total: batch.length, name: file.name }));

        try {
          if (file.size > MAX_BYTES) throw new Error("Larger than 25MB.");

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
              shared: form.get("shared") !== "false",
            })
            .returning();

          const count = await ingestDocument(doc.id, buf, doc.mime, doc.filename);
          done.push({ name: file.name, chunks: count });
        } catch (e) {
          failed.push({
            name: file.name,
            why: e instanceof Error ? e.message : "Could not read that file.",
          });
        }
      }

      const sections = (n: number) => `${n} section${n === 1 ? "" : "s"}`;
      const lines: string[] = [];

      if (done.length === 1) {
        lines.push(`I've read "${done[0].name}" (${sections(done[0].chunks)}).`);
      } else if (done.length > 1) {
        lines.push(`I've read ${done.length} files:`);
        lines.push(...done.map((d) => `  • ${d.name} (${sections(d.chunks)})`));
      }
      if (done.length) lines.push("Ask me anything about them.");

      if (failed.length) {
        if (lines.length) lines.push("");
        lines.push(failed.length === 1 ? "One file failed:" : `${failed.length} files failed:`);
        lines.push(...failed.map((f) => `  • ${f.name} — ${f.why}`));
      }
      if (skipped > 0) {
        lines.push("");
        lines.push(`${skipped} more were skipped — ${MAX_FILES} files at a time is the limit.`);
      }

      const summary = lines.join("\n");

      // Uploading into a fresh chat starts the conversation, otherwise the
      // summary would have nowhere to live and would vanish on reload.
      if (!convId && summary && done.length) {
        const title =
          done.length === 1 ? done[0].name : `${done.length} files uploaded`;
        const [created] = await db
          .insert(conversations)
          .values({ userId: user.id, title: title.slice(0, 120) })
          .returning();
        convId = created.id;
      }

      // Write it into the transcript so it is still there after a reload.
      if (convId && summary) {
        await db.insert(messages).values({
          conversationId: convId,
          role: "assistant",
          content: summary,
          model: "upload",
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId));
      }

      controller.enqueue(
        line({ type: "done", summary, uploaded: done, failed, conversationId: convId }),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
