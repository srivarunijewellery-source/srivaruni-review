import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db, type Reel } from "@/lib/db";
import { download, move, writeText, setDescription, FOLDERS } from "@/lib/drive";
import { metaReady, mediaUrl, insights, adResults, adFields } from "@/lib/meta";
import { analyzeAndScore } from "@/lib/process";
import { reportMarkdown } from "@/lib/score";
import { cleanup } from "@/lib/video";

export const runtime = "nodejs";
export const maxDuration = 60; // Hobby ceiling; Pro allows 300
export const dynamic = "force-dynamic";

// Analyse one pending reel (Instagram or Drive) per call. The Analyze button loops until nothing is pending.
async function handler(req: NextRequest) {
  const sb = db();
  const { data: pending } = await sb.from("reels").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(1);
  const reel = pending?.[0] as Reel | undefined;
  if (!reel) return NextResponse.json({ done: true });
  const { data: claimed } = await sb.from("reels").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", reel.id).eq("status", "pending").select("id");
  if (!claimed?.length) return NextResponse.json({ done: false, note: "claimed by another run" });

  const isIg = reel.drive_file_id.startsWith("ig:");
  const work = await mkdtemp(path.join(os.tmpdir(), "sv-"));
  try {
    const videoPath = path.join(work, "in.mp4");
    if (isIg) {
      const url = metaReady() ? await mediaUrl(reel.ig_media_id!) : null;
      if (!url) {
        const msg = "Instagram did not provide a video file for this reel (usually licensed music).";
        await sb.from("reels").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("id", reel.id);
        return NextResponse.json({ done: false, skipped: reel.name, reason: msg });
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`media download ${res.status}`);
      await writeFile(videoPath, Buffer.from(await res.arrayBuffer()));
    } else {
      await download(reel.drive_file_id, videoPath);
    }

    const { patch, report, metrics } = await analyzeAndScore(videoPath, work, reel.caption);
    let ins = isIg && metaReady() ? await insights(reel.ig_media_id!).catch(() => null) : reel.insights;
    if (ins && isIg) { const ads = await adResults().catch(() => new Map()); ins = { ...ins, ...adFields(ads.get(reel.ig_media_id!)) }; }
    await sb.from("reels").update({ ...patch, insights: ins }).eq("id", reel.id);

    if (!isIg) {
      const dest = report.verdict === "ready" ? FOLDERS.ready : FOLDERS.fix;
      const md = reportMarkdown(reel.name, report, metrics, `${req.nextUrl.origin}/reel/${reel.id}`);
      await setDescription(reel.drive_file_id, md).catch(() => {});
      await writeText(dest, `${reel.name}.report.txt`, md).catch(() => {});
      await move(reel.drive_file_id, FOLDERS.inbox, dest).catch(() => {});
    }
    return NextResponse.json({ done: false, processed: reel.name, verdict: report.verdict, score: report.score, saves: ins?.saved ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("reels").update({ status: "error", error: msg.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", reel.id);
    return NextResponse.json({ done: false, processed: reel.name, error: msg });
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
