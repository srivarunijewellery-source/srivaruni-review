import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const f = await req.formData();
  const key = String(f.get("key") ?? ""), mark = String(f.get("mark") ?? "unknown"), note = String(f.get("note") ?? "") || null;
  if (key) await db().from("hypothesis_marks").upsert({ key, mark, note, updated_at: new Date().toISOString() });
  return NextResponse.redirect(new URL("/experiments#hyps", req.url), 303);
}
