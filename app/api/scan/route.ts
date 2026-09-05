import { NextResponse } from "next/server";
import { db, type Reel } from "@/lib/db";
import { listInbox, move, setDescription, FOLDERS } from "@/lib/drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Register Drive drafts and bounce oversized ones. Analysis happens in /api/analyze.
async function handler() {
  const sb = db();
  const inbox = await listInbox();
  const MAX_BYTES = +(process.env.MAX_VIDEO_MB ?? 100) * 1024 * 1024;
  let added = 0, bounced = 0;
  for (const f of inbox) {
    const size = +(f.size ?? 0);
    if (size > MAX_BYTES) {
      const msg = `File is ${Math.round(size / 1048576)} MB. Export at 1080p H.264 (under ${process.env.MAX_VIDEO_MB ?? 100} MB) and upload again. Instagram re-encodes to 1080p anyway.`;
      await sb.from("reels").upsert({ drive_file_id: f.id, name: f.name, caption: f.description ?? null, status: "fix", error: msg }, { onConflict: "drive_file_id" });
      await setDescription(f.id, msg).catch(() => {});
      await move(f.id, FOLDERS.inbox, FOLDERS.fix).catch(() => {});
      bounced++;
      continue;
    }
    const { data } = await sb.from("reels").upsert({ drive_file_id: f.id, name: f.name, caption: f.description ?? null }, { onConflict: "drive_file_id", ignoreDuplicates: true }).select("id");
    if (data?.length) added++;
  }
  // Anything stuck in processing for over 5 minutes died on the function limit.
  const stale = new Date(Date.now() - 5 * 60e3).toISOString();
  const { data: dead } = await sb.from("reels").select("id,drive_file_id").eq("status", "processing").lt("updated_at", stale);
  for (const d of (dead ?? []) as Pick<Reel, "id" | "drive_file_id">[]) {
    const isIg = d.drive_file_id.startsWith("ig:");
    const msg = isIg ? "Analysis timed out. Press Analyze again to retry." : "Analysis timed out. Export this reel at 1080p H.264 (under 100 MB) and upload again.";
    await sb.from("reels").update({ status: isIg ? "pending" : "fix", error: isIg ? null : msg, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (!isIg) { await setDescription(d.drive_file_id, msg).catch(() => {}); await move(d.drive_file_id, FOLDERS.inbox, FOLDERS.fix).catch(() => {}); }
  }
  const { count } = await sb.from("reels").select("id", { count: "exact", head: true }).eq("status", "pending");
  return NextResponse.json({ found: inbox.length, added, bounced, pending: count ?? 0 });
}

export async function POST(...args: Parameters<typeof handler>) {
  const utf8 = { "content-type": "application/json; charset=utf-8" };
  try { const r = await handler(...args); r.headers.set("content-type", utf8["content-type"]); return r; }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: utf8 }); }
}
export const GET = POST;
