import { NextResponse } from "next/server";
import { sql } from "@/db";
import { ollamaUp } from "@/lib/ai/ollama";
import { smartModeAvailable } from "@/lib/ai/anthropic";
import { imagesEnabled } from "@/lib/ai/images";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = { app: true, database: false, ollama: false };
  try {
    await sql`SELECT 1`;
    checks.database = true;
  } catch {
    /* reported as false */
  }
  checks.ollama = await ollamaUp();

  const healthy = checks.database && checks.ollama;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, smartMode: smartModeAvailable(), images: imagesEnabled() },
    { status: healthy ? 200 : 503 },
  );
}
