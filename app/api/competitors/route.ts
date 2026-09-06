import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { businessDiscovery, metaReady } from "@/lib/meta";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Add or refresh a competitor: register their recent reels as pending, with media_url and likes/comments/followers.
export async function POST(req: NextRequest) {
  const f = await req.formData();
  const handle = String(f.get("handle") ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return NextResponse.redirect(new URL("/competitors", req.url), 303);
  if (!metaReady()) return NextResponse.redirect(new URL("/competitors?err=meta", req.url), 303);
  try {
    const d = await businessDiscovery(handle);
    const sb = db();
    let added = 0;
    const videos = d.posts.filter((x) => x.media_type === "VIDEO" || x.media_product_type === "REELS");
    const withFile = videos.filter((x) => x.media_url);
    const kinds = d.posts.reduce((m, x) => { m[x.media_type] = (m[x.media_type] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const summary = `${d.posts.length} posts: ${Object.entries(kinds).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}; ${withFile.length} of ${videos.length} videos have a file`;
    for (const p of withFile) {
      const { data } = await sb.from("reels").upsert(
        { drive_file_id: `comp:${handle}:${p.id}`, competitor: handle, name: `@${handle} ${p.timestamp.slice(0, 10)} ${(p.caption ?? "").slice(0, 40).replace(/\s+/g, " ")}`, caption: p.caption ?? null, ig_media_id: p.id, ig_permalink: p.permalink, media_url: p.media_url, created_at: p.timestamp,
          insights: { likes: p.like_count ?? 0, comments: p.comments_count ?? 0, followers: d.followers_count } },
        { onConflict: "drive_file_id", ignoreDuplicates: false },
      ).select("id");
      if (data?.length) added++;
    }
    return NextResponse.redirect(new URL(`/competitors?added=${added}&h=${handle}&info=${encodeURIComponent(summary)}`, req.url), 303);
  } catch (e) {
    return NextResponse.redirect(new URL(`/competitors?err=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`, req.url), 303);
  }
}
