import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const sb = db();
  const count = async (st: string) => (await sb.from("reels").select("id", { count: "exact", head: true }).eq("status", st)).count ?? 0;
  const [pending, processing, paused] = await Promise.all([count("pending"), count("processing"), count("paused")]);
  return NextResponse.json({ pending, processing, paused });
}
