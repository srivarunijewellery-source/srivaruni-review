import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adInsights, metricCount } from "@/lib/meta";
import { ztest } from "@/lib/hypotheses";
export const dynamic = "force-dynamic";

// Pull both ads from Meta, compare rate per impression, store the read.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = db();
  const f = await req.formData().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (f?.get("ad_id_a")) patch.ad_id_a = String(f.get("ad_id_a")).trim();
  if (f?.get("ad_id_b")) patch.ad_id_b = String(f.get("ad_id_b")).trim();
  if (Object.keys(patch).length) await sb.from("experiments").update(patch).eq("id", id);
  const { data: ex } = await sb.from("experiments").select("*").eq("id", id).single();
  if (!ex?.ad_id_a || !ex?.ad_id_b) return NextResponse.redirect(new URL("/experiments?err=ids", req.url), 303);
  try {
    const [A, B] = await Promise.all([adInsights(ex.ad_id_a), adInsights(ex.ad_id_b)]);
    const kA = metricCount(A.actions, ex.metric), kB = metricCount(B.actions, ex.metric);
    const t = ztest(kA, A.impressions, kB, B.impressions);
    const result = { a: { ...A, k: kA }, b: { ...B, k: kB }, test: t, read_at: new Date().toISOString() };
    await sb.from("experiments").update({ result, status: "read", updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await sb.from("experiments").update({ notes: `Read failed: ${e instanceof Error ? e.message : String(e)}` }).eq("id", id);
  }
  return NextResponse.redirect(new URL("/experiments", req.url), 303);
}
