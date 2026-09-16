import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { conversations, messages as messagesTable } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { checkPrompt, recordBlock, systemPromptFor } from "@/lib/safety";
import { streamChat, resolveMode, type ChatMessage } from "@/lib/ai/chat";
import { retrieve, formatExcerpts } from "@/lib/rag";
import { recallMemories, formatMemories, learnFromExchange } from "@/lib/memory";
import { looksLikeImageRequest, extractImagePrompt } from "@/lib/image-intent";
import { generateImage, imagesEnabled } from "@/lib/ai/images";
import { KID_NEGATIVE_PROMPT } from "@/lib/safety";
import { generatedImages } from "@/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(20000),
  mode: z.enum(["local", "smart"]).default("local"),
});

/** Newline-delimited JSON events, so the client can render as tokens arrive. */
function event(obj: unknown) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { message, mode: requestedMode } = parsed.data;

  // Kid accounts are screened before anything reaches a model.
  const verdict = checkPrompt(user.role, message);
  if (!verdict.ok) {
    await recordBlock(user.id, "chat", message, verdict.reason);
    return NextResponse.json(
      {
        error:
          "That's not something I can help with. If it's important, please ask a parent.",
      },
      { status: 403 },
    );
  }

  // Resolve (or create) the conversation, and confirm ownership.
  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId) {
    const [owned] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    const title = message.slice(0, 60) + (message.length > 60 ? "…" : "");
    const [created] = await db
      .insert(conversations)
      .values({ userId: user.id, title })
      .returning();
    conversationId = created.id;
  }

  await db.insert(messagesTable).values({ conversationId, role: "user", content: message });

  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt));

  const convo: ChatMessage[] = history
    .filter((m) => m.role !== "system")
    .slice(-20)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const { mode, model } = resolveMode(requestedMode);
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        controller.enqueue(event({ type: "meta", conversationId: convId, mode, model }));

        // People ask for pictures in plain language rather than reaching for a
        // button, so handle that here instead of letting the chat model
        // pretend it can draw.
        if (imagesEnabled() && looksLikeImageRequest(message)) {
          const subject = extractImagePrompt(message);
          controller.enqueue(event({ type: "status", text: `Drawing ${subject}…` }));

          const renderOpts =
            user.role === "kid"
              ? { negative: KID_NEGATIVE_PROMPT, guidance: 2.5, steps: 6 }
              : {};

          try {
            const url = await generateImage(subject, renderOpts);
            await db.insert(generatedImages).values({
              userId: user.id,
              conversationId: convId,
              prompt: subject,
              storagePath: url,
            });

            full = `Here's what I drew for "${subject}":`;
            await db.insert(messagesTable).values({
              conversationId: convId,
              role: "assistant",
              content: full,
              model: "sdxl-turbo",
              attachments: [url],
            });
            await db.update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, convId));

            controller.enqueue(event({ type: "delta", text: full }));
            controller.enqueue(event({ type: "image", url }));
            controller.enqueue(event({ type: "done" }));
            return;
          } catch (e) {
            const why = e instanceof Error ? e.message : "Image generation failed.";
            controller.enqueue(event({ type: "error", message: why }));
            return;
          }
        }

        // Pull in what we know: documents first, then learned facts.
        const [excerpts, memories] = await Promise.all([
          retrieve(user.id, message).catch(() => []),
          recallMemories(user.id, message).catch(() => []),
        ]);

        const system = [
          systemPromptFor(user.role, user.name),
          formatMemories(memories),
          formatExcerpts(excerpts),
        ]
          .filter(Boolean)
          .join("\n\n");

        if (excerpts.length) {
          controller.enqueue(
            event({ type: "sources", files: [...new Set(excerpts.map((e) => e.filename))] }),
          );
        }

        for await (const delta of streamChat(mode, convo, system)) {
          full += delta;
          controller.enqueue(event({ type: "delta", text: delta }));
        }

        await db.insert(messagesTable).values({
          conversationId: convId,
          role: "assistant",
          content: full,
          model,
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId));

        controller.enqueue(event({ type: "done" }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        controller.enqueue(event({ type: "error", message: msg }));
      } finally {
        controller.close();
        // Learning happens after the user already has their answer.
        if (full) void learnFromExchange(user.id, message);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
