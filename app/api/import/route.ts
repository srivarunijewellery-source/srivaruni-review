import { NextResponse } from "next/server";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db, type Reel } from "@/lib/db";
import { metaReady, recentReels, insights } from "@/lib/meta";
import { analyzeAndScore } from "@/lib/process";
import { cleanup } from "@/lib/video";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Import already-posted reels so the baseline exists on day one. One video analysed per call; call repeatedly until "done".
async function handler() {
  if (!metaReady()) return NextResponse.json({ skipped: "META_ACCESS_TOKEN or IG_USER_ID not set" });
  const sb = db();

  // 1. Register recent reels (ponytail: drive_file_id doubles as the key for imports, prefixed "ig:").
  const posts = await recentReels(60);
  for (const p of posts) {
    await sb.from("reels").upsert(
      { drive_file_id: `ig:${p.id}`, name: `IG ${p.timestamp.slice(0, 10)} ${(p.caption ?? "").slice(0, 40).replace(/\s+/g, " ")}`, caption: p.caption ?? null, ig_media_id: p.id, ig_permalink: p.permalink, created_at: p.timestamp },
      { onConflict: "drive_file_id", ignoreDuplicates: true },
    );
  }

  // 2. Analyse one that has no report yet.
  const { data: pending } = await sb.from("reels").select("*").eq("status", "pending").like("drive_file_id", "ig:%").order("created_at", { ascending: false }).limit(1);
  const reel = pending?.[0] as Reel | undefined;
  if (!reel) return NextResponse.json({ registered: posts.length, done: true });
  const post = posts.find((p) => p.id === reel.ig_media_id);
  if (!post?.media_url) {
    await sb.from("reels").update({ status: "error", error: "no media_url from Graph API" }).eq("id", reel.id);
    return NextResponse.json({ registered: posts.length, processed: reel.name, error: "no media_url" });
  }
  await sb.from("reels").update({ status: "processing" }).eq("id", reel.id);

  const work = await mkdtemp(path.join(os.tmpdir(), "sv-ig-"));
  try {
    const videoPath = path.join(work, "in.mp4");
    const res = await fetch(post.media_url);
    if (!res.ok) throw new Error(`media download ${res.status}`);
    await writeFile(videoPath, Buffer.from(await res.arrayBuffer()));
    const { patch, report } = await analyzeAndScore(videoPath, work, reel.caption);
    const ins = await insights(reel.ig_media_id!).catch(() => null);
    await sb.from("reels").update({ ...patch, insights: ins }).eq("id", reel.id);
    return NextResponse.json({ registered: posts.length, processed: reel.name, score: report.score, saves: ins?.saved ?? null, done: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("reels").update({ status: "error", error: msg.slice(0, 2000) }).eq("id", reel.id);
    return NextResponse.json({ processed: reel.name, error: msg }, { status: 500 });
  } finally {
    await cleanup(work);
  }
}

export async function POST(...args: Parameters<typeof handler>) {
  const utf8 = { "content-type": "application/json; charset=utf-8" };
  try { const r = await handler(...args); r.headers.set("content-type", utf8["content-type"]); return r; }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: utf8 }); }
}
export const GET = POST;
