import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Queue every analysed Instagram reel again (after a rubric change). Drive drafts are left alone.
export async function POST() {
  try {
    const sb = db();
    const { data } = await sb.from("reels").update({ status: "pending", error: null, updated_at: new Date().toISOString() }).like("drive_file_id", "ig:%").in("status", ["ready", "fix", "error"]).select("id");
    return NextResponse.json({ queued: data?.length ?? 0 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
