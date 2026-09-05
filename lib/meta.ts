const G = "https://graph.facebook.com/v21.0";
const token = () => process.env.META_ACCESS_TOKEN!;
export const metaReady = () => !!(process.env.META_ACCESS_TOKEN && process.env.IG_USER_ID);

async function get(path: string) {
  const res = await fetch(`${G}${path}${path.includes("?") ? "&" : "?"}access_token=${token()}`);
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
    url = j.paging?.next ? j.paging.next.replace(G, "").replace(/([?&])access_token=[^&]+/, "$1") : null;
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
