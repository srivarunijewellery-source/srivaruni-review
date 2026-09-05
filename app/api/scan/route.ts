import { NextRequest, NextResponse } from "next/server";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db, type Reel } from "@/lib/db";
import { listInbox, download, move, writeText, setDescription, FOLDERS } from "@/lib/drive";
import { cleanup } from "@/lib/video";
import { reportMarkdown } from "@/lib/score";
import { analyzeAndScore } from "@/lib/process";

export const runtime = "nodejs";
export const maxDuration = 60; // Hobby ceiling; Pro allows 300
export const dynamic = "force-dynamic";

// One video per call keeps us under the function time limit. The Apps Script trigger calls this every 5 minutes.
async function handler(req: NextRequest) {
  const sb = db();

  // 1. Register anything new in the inbox.
  const inbox = await listInbox();
  for (const f of inbox) {
    await sb.from("reels").upsert({ drive_file_id: f.id, name: f.name, caption: f.description ?? null }, { onConflict: "drive_file_id", ignoreDuplicates: true });
  }

  // 1b. Anything stuck in "processing" for over 5 minutes died on the function timeout. Send it to Fix with a clear reason.
  const stale = new Date(Date.now() - 5 * 60e3).toISOString();
  const { data: dead } = await sb.from("reels").select("id,drive_file_id,name").eq("status", "processing").lt("updated_at", stale).not("drive_file_id", "like", "ig:%");
  for (const d of (dead ?? []) as Pick<Reel, "id" | "drive_file_id" | "name">[]) {
    const msg = "Analysis timed out. Export this reel at 1080p H.264 (under 100 MB) and upload again.";
    await sb.from("reels").update({ status: "fix", error: msg, updated_at: new Date().toISOString() }).eq("id", d.id);
    await setDescription(d.drive_file_id, msg).catch(() => {});
    await move(d.drive_file_id, FOLDERS.inbox, FOLDERS.fix).catch(() => {});
  }

  // 2. Claim one pending reel.
  const { data: pending } = await sb.from("reels").select("*").eq("status", "pending").not("drive_file_id", "like", "ig:%").order("created_at").limit(1);
  const reel = pending?.[0] as Reel | undefined;
  if (!reel) return NextResponse.json({ registered: inbox.length, processed: null });
  const { data: claimed } = await sb.from("reels").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", reel.id).eq("status", "pending").select("id");
  if (!claimed?.length) return NextResponse.json({ registered: inbox.length, processed: null, note: "claimed by another run" });

  // 2b. Size gate: 4K masters cannot be decoded inside the function limit. Tell the editor instead of timing out.
  const MAX_BYTES = +(process.env.MAX_VIDEO_MB ?? 100) * 1024 * 1024;
  const size = +(inbox.find((f) => f.id === reel.drive_file_id)?.size ?? 0);
  if (size > MAX_BYTES) {
    const msg = `File is ${Math.round(size / 1048576)} MB. Export at 1080p H.264 (under ${process.env.MAX_VIDEO_MB ?? 100} MB) and upload again. Instagram re-encodes to 1080p anyway.`;
    await sb.from("reels").update({ status: "fix", error: msg, updated_at: new Date().toISOString() }).eq("id", reel.id);
    await setDescription(reel.drive_file_id, msg).catch(() => {});
    await move(reel.drive_file_id, FOLDERS.inbox, FOLDERS.fix);
    return NextResponse.json({ registered: inbox.length, processed: reel.name, verdict: "fix", reason: msg });
  }

  const work = await mkdtemp(path.join(os.tmpdir(), "sv-"));
  try {
    const videoPath = path.join(work, "in.mp4");
    await download(reel.drive_file_id, videoPath);
    const { patch, report, metrics } = await analyzeAndScore(videoPath, work, reel.caption);

    const origin = req.nextUrl.origin;
    await sb.from("reels").update(patch).eq("id", reel.id);

    const dest = report.verdict === "ready" ? FOLDERS.ready : FOLDERS.fix;
    const md = reportMarkdown(reel.name, report, metrics, `${origin}/reel/${reel.id}`);
    // Verdict into the file's own description (always works); a sidecar report file is a bonus that may fail on quota.
    await setDescription(reel.drive_file_id, md);
    await writeText(dest, `${reel.name}.report.txt`, md).catch(() => {});
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

export async function POST(...args: Parameters<typeof handler>) {
  try { return await handler(...args); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
export const GET = POST;
