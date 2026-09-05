import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { metaReady, recentReels } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Register posted reels only. Analysis happens in /api/analyze when the team presses Analyze.
async function handler() {
  if (!metaReady()) return NextResponse.json({ skipped: "META_ACCESS_TOKEN or IG_USER_ID not set" });
  const sb = db();
  const posts = await recentReels(100);
  let added = 0;
  for (const p of posts) {
    const { data } = await sb.from("reels").upsert(
      { drive_file_id: `ig:${p.id}`, name: `IG ${p.timestamp.slice(0, 10)} ${(p.caption ?? "").slice(0, 40).replace(/\s+/g, " ")}`, caption: p.caption ?? null, ig_media_id: p.id, ig_permalink: p.permalink, created_at: p.timestamp },
      { onConflict: "drive_file_id", ignoreDuplicates: true },
    ).select("id");
    if (data?.length) added++;
  }
  const { count } = await sb.from("reels").select("id", { count: "exact", head: true }).eq("status", "pending");
  return NextResponse.json({ found: posts.length, added, pending: count ?? 0 });
}

export async function POST(...args: Parameters<typeof handler>) {
  const utf8 = { "content-type": "application/json; charset=utf-8" };
  try { const r = await handler(...args); r.headers.set("content-type", utf8["content-type"]); return r; }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: utf8 }); }
}
export const GET = POST;
