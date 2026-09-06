import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";

// Create an experiment from the form on /experiments.
export async function POST(req: NextRequest) {
  const f = await req.formData();
  const row = {
    hypothesis: String(f.get("hypothesis") ?? ""),
    variant_a: String(f.get("variant_a") ?? ""),
    variant_b: String(f.get("variant_b") ?? ""),
    ad_id_a: String(f.get("ad_id_a") ?? "").trim() || null,
    ad_id_b: String(f.get("ad_id_b") ?? "").trim() || null,
    metric: String(f.get("metric") ?? "saves"),
    notes: String(f.get("notes") ?? "") || null,
    status: f.get("ad_id_a") && f.get("ad_id_b") ? "running" : "planned",
  };
  await db().from("experiments").insert(row);
  return NextResponse.redirect(new URL("/experiments", req.url), 303);
}
