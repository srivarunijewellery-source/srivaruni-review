import type { Fit } from "./model";

// The catalogue: every variable we can change on a reel, the claim, and the cleanest test for it.
export type Hyp = { key: string; variable: string; claim: string; a: string; b: string; metric: "saves" | "link_clicks" | "follows" | "engagement"; features: string[] };
export const HYPOTHESES: Hyp[] = [
  { key: "ttp", variable: "Time to product", claim: "Opening on the jewellery within 1s earns more saves than a 2 to 3s lead-in.", a: "cut opens on the piece, moving", b: "same reel with a 2s lead-in (logo, hand entering)", metric: "saves", features: ["ttp", "hook"] },
  { key: "price", variable: "Price on first frame", claim: "Showing the ₹ price on frame one increases WhatsApp clicks.", a: "price text on frame 1", b: "no price on screen", metric: "link_clicks", features: ["price"] },
  { key: "telugu", variable: "Telugu on screen", claim: "A Telugu line by second 3 lifts watch-through and saves.", a: "Telugu line at 1 to 3s", b: "English line or none", metric: "saves", features: ["telugu"] },
  { key: "reason", variable: "Reason to stay", claim: "An occasion or comparison line by second 3 lifts saves.", a: "occasion line ('Bathukamma ki')", b: "no line", metric: "saves", features: ["reason", "message"] },
  { key: "deity", variable: "Deity / temple motif", claim: "Deity and temple pieces out-engage other motifs at the same craft level.", a: "deity or temple piece", b: "bridal or contemporary piece, same shooting setup", metric: "saves", features: ["deity"] },
  { key: "face", variable: "Face in frame", claim: "A worn shot with a face earns more saves than hands-only.", a: "piece worn, face visible", b: "piece presented by hands only", metric: "saves", features: ["face", "hands"] },
  { key: "stones", variable: "Coloured stones", claim: "Coloured-stone pieces earn more saves than plain gold-tone.", a: "coloured stones", b: "plain gold-tone", metric: "saves", features: ["stones"] },
  { key: "richness", variable: "Rich look", claim: "Neutral white balance with a hard key light (sparkle) beats warm flat footage.", a: "graded neutral, hard key light", b: "as shot, warm and flat", metric: "saves", features: ["richjudged", "warmth", "sparkle", "richness"] },
  { key: "length", variable: "Length", claim: "A 10 to 12s cut beats the 20 to 25s cut of the same footage.", a: "11s cut", b: "22s cut", metric: "engagement", features: ["dur", "length"] },
  { key: "pacing", variable: "Pacing", claim: "An angle change every 2 to 3s beats a single slow pan.", a: "6+ cuts per 10s", b: "1 to 2 cuts per 10s", metric: "engagement", features: ["cuts", "pacing"] },
  { key: "cta", variable: "Caption CTA", claim: "A WhatsApp number in the caption increases enquiries.", a: "caption ends with WhatsApp number", b: "caption without a number", metric: "link_clicks", features: ["caption"] },
];

export type Evidence = { key: string; r: number | null; coef: number | null; n: number; clarity: "no clarity" | "weak" | "some" | "strong"; direction: "supports" | "against" | "none" };

/** Observational evidence per hypothesis from the fitted model. Clarity is about how much the data can say, not whether it agrees. */
export function evidence(fit: Fit | null, groupCounts: Record<string, number>): Evidence[] {
  return HYPOTHESES.map((h) => {
    const ds = fit ? fit.drivers.filter((d) => h.features.includes(d.key)) : [];
    const main = ds[0];
    const r = main?.r ?? null, coef = main?.coef ?? null;
    const n = fit?.n ?? 0;
    const rare = h.features.some((f) => groupCounts[f] != null && groupCounts[f] < 5);
    const clarity: Evidence["clarity"] = !fit || rare ? "no clarity" : Math.abs(r ?? 0) >= 0.4 ? "strong" : Math.abs(r ?? 0) >= 0.2 ? "some" : "weak";
    const sign = coef ?? r ?? 0;
    const expectedPositive = !["ttp", "dur"].includes(main?.key ?? "");
    const direction: Evidence["direction"] = clarity === "no clarity" || Math.abs(sign) < 1e-6 ? "none" : (sign > 0) === expectedPositive ? "supports" : "against";
    return { key: h.key, r, coef, n, clarity, direction };
  });
}

/** Views per arm to detect a relative lift in a rate at 80% power, two-sided 5%. Baseline p is your own organic rate. */
export function viewsPerArm(p: number, relLift = 0.3) {
  const d = p * relLift;
  if (p <= 0 || d <= 0) return 20000;
  return Math.ceil(((1.96 + 0.84) ** 2 * 2 * p * (1 - p)) / (d * d));
}

/** Two-proportion z-test on rate per impression. Returns z, p-value, and lift. */
export function ztest(kA: number, nA: number, kB: number, nB: number) {
  if (nA < 30 || nB < 30) return null;
  const pA = kA / nA, pB = kB / nB, p = (kA + kB) / (nA + nB);
  const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB)) || 1e-9;
  const z = (pA - pB) / se;
  const pv = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { z: +z.toFixed(2), p: +pv.toFixed(3), lift: pB > 0 ? Math.round(((pA - pB) / pB) * 100) : null, rateA: pA, rateB: pB };
}
function erf(x: number) { const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return y; }

/** A hypothesis is only accepted or rejected on replication: two reads in the same direction, each at p<0.1, or one at p<0.01. */
export function verdict(results: { p: number; lift: number | null }[]): "untested" | "one read" | "supported" | "rejected" | "inconclusive" {
  const reads = results.filter((r) => r.lift != null);
  if (!reads.length) return "untested";
  const pos = reads.filter((r) => r.lift! > 0 && r.p < 0.1), neg = reads.filter((r) => r.lift! < 0 && r.p < 0.1);
  if (pos.length >= 2 || pos.some((r) => r.p < 0.01)) return "supported";
  if (neg.length >= 2 || neg.some((r) => r.p < 0.01)) return "rejected";
  if (reads.length >= 3) return "inconclusive";
  return "one read";
}

export type Mark = "supported" | "rejected" | "retest" | "unknown";
export type MarkRow = { key: string; mark: Mark; note: string | null };

/** Manual mark wins; "retest" keeps the item on the roadmap whatever the reads say. */
export function finalVerdict(computed: ReturnType<typeof verdict>, mark?: Mark) {
  if (mark === "supported" || mark === "rejected") return mark;
  if (mark === "retest") return "retest" as const;
  return computed;
}

// ---------- A/B lab plans from the reels you already have ----------
import type { Reel } from "./db";
import type { Scores } from "./dimensions";

/** Frame index -> seconds, matching lib/video.pickForClaude (4 fps for the first 3s, then 1 fps). */
export const frameTime = (i: number) => (i < 12 ? i * 0.25 : 3 + (i - 12));

export type Candidate = { r: Reel; s: Scores; eng: number | null };
export type Arm = { label: string; steps: string[]; reel?: { id: string; name: string; thumb: string | null } };
export type Plan = {
  kind: "edit" | "pair" | "shoot";
  why: string;              // why this reel was picked
  a: Arm; b: Arm;
  alternates: { id: string; name: string }[];
  caption: string;
  metric: string;
};

const fmt = (x: number) => x.toFixed(1) + "s";
const ref = (c: Candidate) => ({ id: c.r.id, name: c.r.name, thumb: c.r.thumb ?? null });
const rep = (c: Candidate) => c.r.report!;
const met = (c: Candidate) => c.r.metrics!;

/** Product stretch: first and last second the jewellery fills the frame. */
function productSpan(c: Candidate) {
  const pf = rep(c).product_frames ?? [];
  if (!pf.length) return null;
  return { start: frameTime(Math.min(...pf)), end: frameTime(Math.max(...pf)) + 1 };
}

/** Reels strong on every dimension except the ones under test, best engagement first, so the test isolates one variable. */
function strong(cands: Candidate[], exceptKeys: string[], min = 55) {
  return cands
    .filter((c) => (Object.keys(c.s) as (keyof Scores)[]).filter((k) => k !== "overall" && !exceptKeys.includes(k)).every((k) => c.s[k] >= min))
    .sort((a, b) => (b.eng ?? -1) - (a.eng ?? -1) || b.s.overall - a.s.overall);
}

const EXPORT = "Export both at 1080x1920, H.264, same length, same audio, same first frame unless the test is about the first frame.";
const ADS = "Ads Manager: one campaign, two ad sets identical in audience, placement and daily budget, one ad each, 4 to 5 days. Paste both ad IDs in Log a test.";

export function planFor(h: Hyp, cands: Candidate[]): Plan {
  const base = (c: Candidate | undefined, why: string, a: Arm, b: Arm, alts: Candidate[], caption: string, kind: Plan["kind"] = "edit"): Plan => ({
    kind, why, a: { ...a, reel: c ? ref(c) : a.reel }, b: { ...b, reel: c ? ref(c) : b.reel }, alternates: alts.map((x) => ({ id: x.r.id, name: x.r.name })), caption, metric: h.metric,
  });
  const none = (why: string): Plan => ({ kind: "shoot", why, a: { label: h.a, steps: ["No suitable reel in the library yet. Shoot a fresh pair on the same set, same light, same model."] }, b: { label: h.b, steps: ["Same as A, only the variable changes."] }, alternates: [], caption: "Same caption on both.", metric: h.metric });

  switch (h.key) {
    case "ttp": {
      const cs = strong(cands, ["hook"]).filter((c) => (rep(c).time_to_product_s ?? 9) > 1.2);
      if (!cs.length) {
        const st = strong(cands, ["hook"]).slice(0, 3); if (!st.length) return none("No strong reel yet.");
        const c = st[0];
        return base(c, `${c.r.name} already opens on the product (${fmt(rep(c).time_to_product_s ?? 0)}), so B gets a lead-in added.`, { label: "opens on the piece", steps: ["Use the reel exactly as posted."] }, { label: "2s lead-in", steps: ["Insert a 2.0s title card before frame 1: plain dark background, store name in gold, no product.", "Everything after is identical."] }, st.slice(1), "Same caption on both.");
      }
      const c = cs[0], t = rep(c).time_to_product_s!, span = productSpan(c);
      return base(c, `${c.r.name} is strong everywhere except the opening: the piece appears at ${fmt(t)}.`,
        { label: "cut to open on the piece", steps: [`Delete 0.0s to ${fmt(Math.max(0, t - 0.25))}. The first visible frame is now the jewellery already moving${span ? ` (product runs ${fmt(span.start)} to ${fmt(span.end)})` : ""}.`, "Keep the rest of the cut, audio realigned to the new start.", "Add the ₹ price as text on the new frame 1 only if it was already on the original; do not add anything new."] },
        { label: "as posted", steps: [`The reel exactly as posted, product at ${fmt(t)}.`] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "price": {
      const cs = strong(cands, ["message"]).filter((c) => rep(c).price_on_screen_s == null);
      if (!cs.length) return none("Every strong reel already shows a price; remove it for B on one of them instead.");
      const c = cs[0];
      return base(c, `${c.r.name} is strong on craft and shows no price, so one text layer is the only difference.`,
        { label: "price on frame 1", steps: ["Add a text layer: the real ₹ price of the piece, bold, white with a thin dark outline, bottom third, centred.", "On screen from 0.0s to 2.0s, then hard cut out. No animation.", "Nothing else changes."] },
        { label: "no price", steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Both captions carry the same wa.me link; the metric is link clicks.");
    }
    case "telugu": {
      const cs = strong(cands, ["message"]).filter((c) => rep(c).telugu_text_s == null);
      if (!cs.length) return none("No strong reel without a Telugu line.");
      const c = cs[0], hook = rep(c).hooks?.[0];
      return base(c, `${c.r.name} has no Telugu on screen; its own suggested hook is ready to use.`,
        { label: "Telugu line 1s to 3.5s", steps: [`Add a text layer${hook ? `: "${hook}"` : " in Telugu: the occasion or the price claim"}. Noto Sans Telugu bold, white, dark outline, upper third.`, "On screen from 1.0s to 3.5s. No animation.", "Nothing else changes."] },
        { label: "no line", steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "reason": {
      const cs = strong(cands, ["message"]).filter((c) => rep(c).reason_to_stay_s == null || rep(c).reason_to_stay_s! > 3);
      if (!cs.length) return none("Every strong reel already gives a reason by second 3.");
      const c = cs[0], occ = rep(c).subject?.occasion;
      return base(c, `${c.r.name} never tells the viewer why this piece matters now.`,
        { label: "reason by second 3", steps: [`Add a text layer at 1.5s to 4.0s: ${occ ? `"${occ} ki perfect"` : "the occasion (\"Bathukamma ki\"), or a comparison (\"1/20th the price\")"}.`, "Upper third, bold, no animation.", "Nothing else changes."] },
        { label: "no reason", steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "richness": {
      const cs = strong(cands, ["richness", "light"]).filter((c) => (rep(c).richness?.score ?? 100) < 60 || (met(c).warmth ?? 0) > 35).sort((a, b) => (met(b).warmth ?? 0) - (met(a).warmth ?? 0));
      if (!cs.length) return none("No strong reel with a warm or flat look to grade.");
      const c = cs[0], fix = rep(c).richness?.fix, issues = rep(c).richness?.issues ?? [];
      return base(c, `${c.r.name} reads ${issues.length ? issues.map((i) => i.replace(/_/g, " ")).join(", ") : "warm"} (cast ${met(c).warmth ?? "–"}, judged ${rep(c).richness?.score ?? "–"}/100).`,
        { label: "graded neutral", steps: [`Colour grade on the whole clip, no re-cut: temperature ${(met(c).warmth ?? 40) > 50 ? "−25" : "−15"} (until the metal reads neutral, not blue), contrast +12, highlights −10, shadows −5, saturation +5.`, fix ? `Claude's note on this reel: ${fix}` : "Check the stones: they should read white or their true colour, not yellow.", "Export at the same bitrate."] },
        { label: "as shot", steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "length": {
      const cs = strong(cands, ["length"]).filter((c) => met(c).duration_s > 16);
      if (!cs.length) return none("No strong reel over 16s to trim.");
      const c = cs[0], span = productSpan(c), start = span ? Math.max(0, span.start - 0.25) : 0;
      return base(c, `${c.r.name} runs ${met(c).duration_s}s${span ? `; the jewellery is on screen ${fmt(span.start)} to ${fmt(span.end)}` : ""}.`,
        { label: "11s cut", steps: [`In: ${fmt(start)}. Out: ${fmt(start + 11)}. Keep the audio from the same window.`, "End on a clean product frame, no fade.", "Same first frame as B."] },
        { label: `full ${met(c).duration_s}s`, steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "pacing": {
      const cs = strong(cands, ["pacing"]).filter((c) => met(c).cuts_per_10s < 3);
      if (!cs.length) return none("No strong slow-cut reel.");
      const c = cs[0], d = met(c).duration_s, marks = Array.from({ length: Math.floor(d / 2.5) }, (_, i) => fmt((i + 1) * 2.5)).slice(0, 6).join(", ");
      return base(c, `${c.r.name} has ${met(c).cuts} cuts in ${d}s.`,
        { label: "cut every 2.5s", steps: [`Split at ${marks}.`, "On every second segment apply a 5% punch-in (scale 105%, keep centre). No transitions.", "Audio untouched."] },
        { label: "as posted", steps: ["The reel exactly as posted."] }, cs.slice(1, 3), "Same caption on both.");
    }
    case "cta": {
      const st = strong(cands, ["caption"]).slice(0, 3); if (!st.length) return none("No strong reel yet.");
      const c = st[0];
      return base(c, `${c.r.name} is your strongest reel; only the caption differs.`,
        { label: "caption with WhatsApp", steps: ["Identical video.", "Caption ends: \"WhatsApp: <number>\" plus the wa.me link."] },
        { label: "caption without", steps: ["Identical video.", "Same caption with the number and link removed."] }, st.slice(1), "That is the whole test; the metric is link clicks.");
    }
    default: {
      const on = (c: Candidate) => { const sub = rep(c).subject; if (!sub) return false; if (h.key === "deity") return sub.motif === "deity_temple"; if (h.key === "face") return sub.person === "face_visible"; if (h.key === "stones") return sub.colour === "coloured_stones"; return false; };
      const off = (c: Candidate) => { const sub = rep(c).subject; if (!sub) return false; if (h.key === "deity") return sub.motif !== "deity_temple" && sub.motif !== "other"; if (h.key === "face") return sub.person === "hands_only"; if (h.key === "stones") return sub.colour === "gold"; return false; };
      const A = cands.filter(on).sort((a, b) => (b.eng ?? 0) - (a.eng ?? 0)), B = cands.filter(off);
      let best: { a: Candidate; b: Candidate; d: number } | null = null;
      for (const a of A) for (const b of B) { const d = Math.abs(a.s.overall - b.s.overall) + Math.abs(a.s.richness - b.s.richness) / 2; if (!best || d < best.d) best = { a, b, d }; }
      if (best && best.d <= 15) return { kind: "pair", why: `These two are within ${Math.round(best.d)} craft points, so the subject is the only real difference.`, a: { label: h.a, steps: ["Use exactly as posted."], reel: ref(best.a) }, b: { label: h.b, steps: ["Use exactly as posted."], reel: ref(best.b) }, alternates: [], caption: "Same caption structure on both, same price band if possible.", metric: h.metric };
      return { kind: "shoot", why: `No matched pair yet: ${A.length} reels with ${h.a}, ${B.length} with ${h.b}.`, a: { label: h.a, steps: ["Shoot on the same set, same light, same model, same framing as B, same day.", "Open on the piece, price on frame 1, Telugu line by 3s, 11s."], reel: A[0] ? ref(A[0]) : undefined }, b: { label: h.b, steps: ["Identical setup; only the piece changes."], reel: B[0] ? ref(B[0]) : undefined }, alternates: [], caption: "Same caption on both.", metric: h.metric };
    }
  }
}

export const PLAN_FOOTER = [EXPORT, ADS];
