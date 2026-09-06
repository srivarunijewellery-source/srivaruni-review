import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
// pause: pending -> paused (chains stop because nothing is pending). resume: paused -> pending.
export async function POST(req: NextRequest) {
  const resume = req.nextUrl.searchParams.get("resume") === "1";
  const { data } = await db().from("reels").update({ status: resume ? "pending" : "paused", updated_at: new Date().toISOString() }).eq("status", resume ? "paused" : "pending").select("id");
  return NextResponse.json({ changed: data?.length ?? 0 });
}
