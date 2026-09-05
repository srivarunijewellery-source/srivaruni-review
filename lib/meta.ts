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

/** Video file for one media id, or null when Instagram will not serve it (usually licensed music). */
export async function mediaUrl(mediaId: string): Promise<string | null> {
  const j = await get(`/${mediaId}?fields=media_url,media_type`);
  return j.media_url ?? null;
}

export type AdResult = { spend: number; impressions: number; actions: Record<string, number>; cpa: Record<string, number> };

/** Ad spend and results per Instagram media id, summed across every ad that used the post. Needs META_AD_ACCOUNT_ID and ads_read. */
let adCache: { at: number; map: Map<string, AdResult> } | null = null;
export async function adResults(): Promise<Map<string, AdResult>> {
  const acct = process.env.META_AD_ACCOUNT_ID;
  if (!acct) return new Map();
  if (adCache && Date.now() - adCache.at < 10 * 60e3) return adCache.map;
  const map = new Map<string, AdResult>();
  let url: string | null = `/act_${acct}/ads?fields=creative{effective_instagram_media_id},insights.date_preset(maximum){spend,impressions,actions,cost_per_action_type}&limit=100`;
  type Row = { creative?: { effective_instagram_media_id?: string }; insights?: { data: { spend: string; impressions: string; actions?: { action_type: string; value: string }[]; cost_per_action_type?: { action_type: string; value: string }[] }[] } };
  for (let page = 0; url && page < 10; page++) {
    const j: { data: Row[]; paging?: { next?: string } } = await get(url);
    for (const a of j.data) {
      const id = a.creative?.effective_instagram_media_id, ins = a.insights?.data?.[0];
      if (!id || !ins) continue;
      const cur = map.get(id) ?? { spend: 0, impressions: 0, actions: {}, cpa: {} };
      cur.spend += +ins.spend || 0; cur.impressions += +ins.impressions || 0;
      for (const x of ins.actions ?? []) cur.actions[x.action_type] = (cur.actions[x.action_type] ?? 0) + (+x.value || 0);
      map.set(id, cur);
    }
    url = j.paging?.next ?? null;
  }
  for (const r of map.values()) for (const [k, v] of Object.entries(r.actions)) r.cpa[k] = v > 0 ? +(r.spend / v).toFixed(2) : 0;
  adCache = { at: Date.now(), map };
  return map;
}

export async function boostedMediaIds(): Promise<Set<string>> { return new Set((await adResults()).keys()); }

/** Flatten ad results into the insights record: ad_spend, ad_follows, ad_cost_per_follow, ad_saves, ad_cost_per_save. */
export function adFields(r: AdResult | undefined): Record<string, number> {
  if (!r) return { boosted: 0 };
  const pick = (re: RegExp) => Object.entries(r.actions).find(([k]) => re.test(k));
  const follow = pick(/follow/i), save = pick(/post_save|save/i), eng = pick(/^post_engagement$/);
  const out: Record<string, number> = { boosted: 1, ad_spend: Math.round(r.spend), ad_impressions: r.impressions };
  if (follow) { out.ad_follows = follow[1]; out.ad_cost_per_follow = r.cpa[follow[0]]; }
  if (save) { out.ad_saves = save[1]; out.ad_cost_per_save = r.cpa[save[0]]; }
  if (eng) { out.ad_engagements = eng[1]; out.ad_cost_per_engagement = r.cpa[eng[0]]; }
  return out;
}
