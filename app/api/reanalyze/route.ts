import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Queue every scored reel again (after a rubric change). Ones with stored frames re-score without touching the video.
export async function POST() {
  try {
    const sb = db();
    const { data } = await sb.from("reels").update({ status: "pending", error: null, updated_at: new Date().toISOString() }).in("status", ["ready", "fix", "error"]).not("frames", "is", null).select("id");
    return NextResponse.json({ queued: data?.length ?? 0 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
