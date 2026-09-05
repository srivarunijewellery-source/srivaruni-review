import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaReady, mediaIdForPermalink, insights } from "@/lib/meta";

// Editor pastes the Instagram link after posting; we resolve the media id and pull insights right away if Meta is configured.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const permalink = String(form.get("permalink") ?? "").trim();
  const sb = db();
  const patch: Record<string, unknown> = { ig_permalink: permalink || null, updated_at: new Date().toISOString() };
  if (permalink && metaReady()) {
    const mediaId = await mediaIdForPermalink(permalink).catch(() => null);
    if (mediaId) {
      patch.ig_media_id = mediaId;
      patch.insights = await insights(mediaId).catch(() => null);
    }
  }
  await sb.from("reels").update(patch).eq("id", id);
  return NextResponse.redirect(new URL(`/reel/${id}`, req.url), 303);
}
