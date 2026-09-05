import { NextResponse } from "next/server";
import { inspectRoot } from "@/lib/drive";

export const dynamic = "force-dynamic";

// Shows the root folder and its children exactly as the service account sees them. Use it to debug sharing and names.
export async function GET() {
  try { return NextResponse.json(await inspectRoot()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
