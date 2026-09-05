import type { Reel, Report, Metrics } from "./db";

// Seven things that make a jewellery reel work on Instagram, each 0-100. The bar is the 75th percentile of your own posted reels.
export const DIMS = [
  { key: "hook", label: "Hook speed", weight: 0.22, help: "How fast the jewellery fills the frame" },
  { key: "clarity", label: "Clarity", weight: 0.18, help: "Sharpness on the product frames" },
  { key: "message", label: "Message", weight: 0.18, help: "Price, reason to stay, Telugu line by second 3" },
  { key: "product", label: "Product time", weight: 0.1, help: "Share of the reel with jewellery filling the frame" },
  { key: "pacing", label: "Pacing", weight: 0.08, help: "Angle changes per 10 seconds" },
  { key: "light", label: "Light", weight: 0.08, help: "Exposure on the product" },
  { key: "length", label: "Length", weight: 0.06, help: "7 to 15 seconds" },
  { key: "caption", label: "Caption", weight: 0.1, help: "WhatsApp CTA and clean hashtags" },
] as const;
export type DimKey = (typeof DIMS)[number]["key"];
export type Scores = Record<DimKey, number> & { overall: number };

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function scoreDims(r: Report, m: Metrics, caption: string | null, frameCount = 0): Scores {
  const ttp = r.time_to_product_s;
  const hook = ttp === null ? 0 : clamp(100 - ttp * 33);
  const clarity = clamp(m.sharpness);
  const price = r.price_on_screen_s === null ? 0 : r.price_on_screen_s <= 1 ? 40 : r.price_on_screen_s <= 3 ? 25 : 10;
  const stay = r.reason_to_stay_s === null ? 0 : r.reason_to_stay_s <= 3 ? 35 : r.reason_to_stay_s <= 6 ? 20 : 8;
  const te = r.telugu_text_s === null ? 0 : r.telugu_text_s <= 3 ? 25 : 10;
  const message = clamp(price + stay + te);
  const pacing = clamp((m.cuts_per_10s / 6) * 100);
  const light = m.brightness > 220 ? clamp(100 - (m.brightness - 220) * 2) : clamp(((m.brightness - 40) / 110) * 100);
  const d = m.duration_s;
  const length = d >= 7 && d <= 15 ? 100 : d < 7 ? clamp(100 - (7 - d) * 15) : clamp(100 - (d - 15) * 8);
  const hasCta = /whatsapp|dm|message|visit/i.test(caption ?? "");
  const tags = (caption?.match(/#\w+/g) ?? []).length;
  const cap = clamp((hasCta ? 60 : 0) + (tags <= 5 ? 40 : tags <= 10 ? 20 : 5));
  const product = frameCount > 0 ? clamp(((r.product_frames?.length ?? 0) / frameCount) * 100 * 1.25) : 50; // 80% of frames = full marks
  const s = { hook, clarity, message, product, pacing, light, length, caption: cap };
  const overall = Math.round(DIMS.reduce((a, dd) => a + s[dd.key] * dd.weight, 0));
  return { ...s, overall };
}

export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo));
};

/** The bar: p75 on each dimension across posted Instagram reels (falls back to every scored reel while the sample is small). */
export function computeBar(reels: Reel[]) {
  const scored = reels.filter((r) => r.report && r.metrics);
  const posted = scored.filter((r) => r.drive_file_id.startsWith("ig:") && !r.insights?.boosted); // organic only: ads must not set the bar
  const base = posted.length >= 5 ? posted : scored;
  const all = base.map((r) => scoreDims(r.report!, r.metrics!, r.caption, r.frames?.length ?? 0));
  const bar = Object.fromEntries([...DIMS.map((d) => d.key), "overall"].map((k) => [k, percentile(all.map((s) => s[k as keyof Scores]), 0.75)])) as Scores;
  const mid = Object.fromEntries([...DIMS.map((d) => d.key), "overall"].map((k) => [k, percentile(all.map((s) => s[k as keyof Scores]), 0.5)])) as Scores;
  return { bar, mid, n: base.length, source: posted.length >= 5 ? "instagram" : "all" as const };
}

export type Tag = "raises" | "meets" | "below";
export function tagFor(s: Scores, bar: Scores, mid: Scores): Tag {
  if (s.overall >= bar.overall) return "raises";
  if (s.overall >= mid.overall) return "meets";
  return "below";
}
export const TAG_LABEL: Record<Tag, string> = { raises: "Raises the bar", meets: "Meets the bar", below: "Below the bar" };

/** Engagement as rates so boosted and organic reels compare on the creative, not the spend. */
export type Rates = { views: number; saveRate: number; shareRate: number; likeRate: number; commentRate: number; watchS: number | null; watchThrough: number | null; boosted: boolean };
export function rates(ins: Record<string, number> | null | undefined, durationS: number | undefined): Rates | null {
  if (!ins) return null;
  const views = ins.views ?? ins.plays ?? ins.reach ?? 0;
  const per1k = (x?: number) => (views > 0 ? Math.round(((x ?? 0) / views) * 1000) : 0);
  const watchS = ins.ig_reels_avg_watch_time != null ? Math.round(ins.ig_reels_avg_watch_time / 1000) : null;
  return {
    views,
    saveRate: per1k(ins.saved),
    shareRate: per1k(ins.shares),
    likeRate: views > 0 ? Math.round(((ins.likes ?? 0) / views) * 100) : 0,
    commentRate: per1k(ins.comments),
    watchS,
    watchThrough: watchS != null && durationS ? Math.min(100, Math.round((watchS / durationS) * 100)) : null,
    boosted: !!ins.boosted,
  };
}

/** Pearson correlation, null when there is not enough spread to say anything. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 6) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return +(sxy / Math.sqrt(sxx * syy)).toFixed(2);
}
export const strength = (r: number | null) => r === null ? "not enough data" : Math.abs(r) >= 0.5 ? (r > 0 ? "strong" : "strong, inverse") : Math.abs(r) >= 0.25 ? (r > 0 ? "some" : "some, inverse") : "none";

export const SUBJECT_LABEL: Record<string, string> = {
  deity_temple: "Deity / temple", floral_nature: "Floral", bridal_heavy: "Bridal heavy", minimal_daily: "Minimal daily", contemporary: "Contemporary", other: "Other",
  necklace_set: "Necklace set", choker: "Choker", long_haram: "Long haram", earrings: "Earrings", bangles: "Bangles", maang_tikka: "Maang tikka", mixed: "Mixed",
  none: "No person", hands_only: "Hands only", face_visible: "Face visible",
  gold: "Gold", silver: "Silver", coloured_stones: "Coloured stones", pearls: "Pearls",
};
export const label = (k: string | null | undefined) => (k ? SUBJECT_LABEL[k] ?? k : "–");
