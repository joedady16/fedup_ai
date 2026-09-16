import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getUser } from "@/lib/auth";
import { IMAGES_DIR } from "@/lib/ai/images";

export const dynamic = "force-dynamic";

/** Serves generated pictures to signed-in users only. */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });

  const { name } = await ctx.params;
  // Reject anything that isn't a plain generated filename.
  const match = /^[\w-]+\.(png|svg)$/.exec(name);
  if (!match) return new NextResponse("Not found", { status: 404 });
  const isSvg = match[1] === "svg";

  try {
    const bytes = await readFile(path.join(IMAGES_DIR, name));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": isSvg ? "image/svg+xml; charset=utf-8" : "image/png",
        "cache-control": "private, max-age=31536000",
        // SVG is model-authored markup. It is sanitised on the way in and
        // rendered through <img>, and this stops anything that slipped
        // through from loading or executing if opened directly.
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
