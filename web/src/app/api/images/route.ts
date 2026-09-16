import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, generatedImages, messages } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { generateImage, imagesEnabled } from "@/lib/ai/images";
import { checkPrompt, recordBlock, KID_NEGATIVE_PROMPT } from "@/lib/safety";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!imagesEnabled()) {
    return NextResponse.json({ error: "Image generation is turned off." }, { status: 503 });
  }

  const { prompt, conversationId } = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    conversationId?: string;
  };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Describe the picture you want." }, { status: 400 });
  }

  const verdict = checkPrompt(user.role, prompt);
  if (!verdict.ok) {
    await recordBlock(user.id, "image", prompt, verdict.reason);
    return NextResponse.json(
      { error: "I can't draw that one. Try something else!" },
      { status: 403 },
    );
  }

  // Children always get the safety negative prompt applied.
  const negative = user.role === "kid" ? KID_NEGATIVE_PROMPT : "blurry, low quality, watermark";

  try {
    const url = await generateImage(prompt, negative);

    // Only attach to a conversation the requester actually owns.
    let convId: string | null = null;
    if (conversationId) {
      const [owned] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)))
        .limit(1);
      convId = owned?.id ?? null;
    }

    await db.insert(generatedImages).values({
      userId: user.id,
      conversationId: convId,
      prompt,
      storagePath: url,
    });

    // Write it into the transcript, otherwise the picture disappears on reload.
    if (convId) {
      await db.insert(messages).values([
        { conversationId: convId, role: "user", content: `Draw: ${prompt}` },
        { conversationId: convId, role: "assistant", content: "Here you go:", attachments: [url] },
      ]);
      await db.update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, convId));
    }

    return NextResponse.json({ url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
