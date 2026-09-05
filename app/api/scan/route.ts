import { NextRequest, NextResponse } from "next/server";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db, type Reel } from "@/lib/db";
import { listInbox, download, move, writeText, FOLDERS } from "@/lib/drive";
import { analyze, pickForClaude, pickForStorage, transcribe, cleanup } from "@/lib/video";
import { scoreWithClaude, reportMarkdown } from "@/lib/score";

export const runtime = "nodejs";
export const maxDuration = 60; // Hobby ceiling; Pro allows 300
export const dynamic = "force-dynamic";

// One video per call keeps us under the function time limit. The Apps Script trigger calls this every 5 minutes.
export async function POST(req: NextRequest) {
  const sb = db();

  // 1. Register anything new in the inbox.
  const inbox = await listInbox();
  for (const f of inbox) {
    await sb.from("reels").upsert({ drive_file_id: f.id, name: f.name, caption: f.description ?? null }, { onConflict: "drive_file_id", ignoreDuplicates: true });
  }

  // 2. Claim one pending reel.
  const { data: pending } = await sb.from("reels").select("*").eq("status", "pending").order("created_at").limit(1);
  const reel = pending?.[0] as Reel | undefined;
  if (!reel) return NextResponse.json({ registered: inbox.length, processed: null });
  const { data: claimed } = await sb.from("reels").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", reel.id).eq("status", "pending").select("id");
  if (!claimed?.length) return NextResponse.json({ registered: inbox.length, processed: null, note: "claimed by another run" });

  const work = await mkdtemp(path.join(os.tmpdir(), "sv-"));
  try {
    const videoPath = path.join(work, "in.mp4");
    await download(reel.drive_file_id, videoPath);
    const { frames, metrics, audioPath } = await analyze(videoPath, path.join(work, "frames"));
    const [transcript, stored] = await Promise.all([transcribe(audioPath), pickForStorage(frames)]);
    const report = await scoreWithClaude({ frames: pickForClaude(frames), metrics, caption: reel.caption, transcript });

    const origin = req.nextUrl.origin;
    await sb.from("reels").update({ status: report.verdict, metrics, report, frames: stored, transcript, error: null, updated_at: new Date().toISOString() }).eq("id", reel.id);

    const dest = report.verdict === "ready" ? FOLDERS.ready : FOLDERS.fix;
    await writeText(dest, `${reel.name}.report.txt`, reportMarkdown(reel.name, report, metrics, `${origin}/reel/${reel.id}`));
    await move(reel.drive_file_id, FOLDERS.inbox, dest);

    return NextResponse.json({ registered: inbox.length, processed: reel.name, verdict: report.verdict, score: report.score });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("reels").update({ status: "error", error: msg.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", reel.id);
    return NextResponse.json({ processed: reel.name, error: msg }, { status: 500 });
  } finally {
    await cleanup(work);
  }
}

export const GET = POST;
