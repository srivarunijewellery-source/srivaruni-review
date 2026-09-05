import { NextResponse } from "next/server";
import { db, type Reel } from "@/lib/db";
import { metaReady, mediaIdForPermalink, insights } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily: refresh insights for everything posted in the last 60 days.
export async function POST() {
  if (!metaReady()) return NextResponse.json({ skipped: "META_ACCESS_TOKEN or IG_USER_ID not set" });
  const sb = db();
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await sb.from("reels").select("id,ig_media_id,ig_permalink").not("ig_permalink", "is", null).gte("updated_at", since);
  let updated = 0;
  for (const r of (data ?? []) as Pick<Reel, "id" | "ig_media_id" | "ig_permalink">[]) {
    const mediaId = r.ig_media_id ?? (await mediaIdForPermalink(r.ig_permalink!).catch(() => null));
    if (!mediaId) continue;
    const ins = await insights(mediaId).catch(() => null);
    if (!ins) continue;
    await sb.from("reels").update({ ig_media_id: mediaId, insights: ins }).eq("id", r.id);
    updated++;
  }
  return NextResponse.json({ updated });
}

export const GET = POST;
