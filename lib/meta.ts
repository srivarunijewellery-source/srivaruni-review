const G = "https://graph.facebook.com/v21.0";
const token = () => process.env.META_ACCESS_TOKEN!;
export const metaReady = () => !!(process.env.META_ACCESS_TOKEN && process.env.IG_USER_ID);

async function get(path: string) {
  // Paging links from Meta are absolute and already carry the token; use them as-is.
  const url = path.startsWith("http") ? path : `${G}${path}${path.includes("?") ? "&" : "?"}access_token=${token()}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

/** Find the IG media id for a permalink by scanning recent media. Good enough for ~100 posts back. */
export async function mediaIdForPermalink(permalink: string): Promise<string | null> {
  const code = permalink.match(/\/(?:reel|p)\/([\w-]+)/)?.[1];
  if (!code) return null;
  let url: string | null = `/${process.env.IG_USER_ID}/media?fields=id,permalink&limit=100`;
  for (let page = 0; url && page < 3; page++) {
    const j: { data: { id: string; permalink: string }[]; paging?: { next?: string } } = await get(url);
    const hit = j.data.find((m) => m.permalink.includes(`/${code}/`));
    if (hit) return hit.id;
    url = j.paging?.next ?? null;
  }
  return null;
}

const METRICS = ["views", "reach", "saved", "shares", "likes", "comments", "ig_reels_avg_watch_time", "total_interactions"];

/** Meta renames metrics every few months; ask for all, fall back to one at a time so one bad name never blanks the row. */
export async function insights(mediaId: string): Promise<Record<string, number>> {
  const parse = (j: { data: { name: string; values: { value: number }[] }[] }) =>
    Object.fromEntries(j.data.map((d) => [d.name, d.values?.[0]?.value ?? 0]));
  try {
    return parse(await get(`/${mediaId}/insights?metric=${METRICS.join(",")}`));
  } catch {
    const out: Record<string, number> = {};
    for (const m of METRICS) {
      try { Object.assign(out, parse(await get(`/${mediaId}/insights?metric=${m}`))); } catch { /* unsupported for this media */ }
    }
    return out;
  }
}

export type IgPost = { id: string; media_type: string; media_url?: string; permalink: string; caption?: string; timestamp: string };

/** Recent video posts (reels) with a downloadable media_url. */
export async function recentReels(limit = 60): Promise<IgPost[]> {
  const out: IgPost[] = [];
  let url: string | null = `/${process.env.IG_USER_ID}/media?fields=id,media_type,media_url,permalink,caption,timestamp&limit=50`;
  while (url && out.length < limit) {
    const j: { data: IgPost[]; paging?: { next?: string } } = await get(url);
    out.push(...j.data.filter((m) => m.media_type === "VIDEO"));
    url = j.paging?.next ?? null;
  }
  return out.slice(0, limit);
}
