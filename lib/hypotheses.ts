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
export type Plan = { kind: "edit" | "pair" | "shoot"; lines: string[]; reels: { id: string; name: string; role: string }[] };

const fmt = (x: number) => x.toFixed(1) + "s";

/** Candidates are reels that are strong on the other dimensions, so the test isolates one variable. */
function strong(cands: Candidate[], exceptKeys: string[], min = 55) {
  return cands.filter((c) => (Object.keys(c.s) as (keyof Scores)[]).filter((k) => k !== "overall" && !exceptKeys.includes(k)).every((k) => c.s[k] >= min || c.s[k] === undefined)).sort((a, b) => (b.eng ?? 0) - (a.eng ?? 0));
}

export function planFor(h: Hyp, cands: Candidate[]): Plan {
  const rep = (c: Candidate) => c.r.report!;
  const met = (c: Candidate) => c.r.metrics!;
  const pick = (f: (c: Candidate) => boolean, keys: string[]) => strong(cands, keys).filter(f).slice(0, 3);
  const asRole = (cs: Candidate[], role: string) => cs.map((c) => ({ id: c.r.id, name: c.r.name, role }));
  switch (h.key) {
    case "ttp": {
      const cs = pick((c) => (rep(c).time_to_product_s ?? 9) > 1.2, ["hook"]);
      if (!cs.length) return { kind: "edit", lines: ["Every strong reel already opens on the product. Make B by adding a 2s title card in front of a strong reel; A stays as is."], reels: asRole(strong(cands, ["hook"]).slice(0, 2), "A: as is") };
      const c = cs[0]; const t = rep(c).time_to_product_s!; const pf = rep(c).product_frames?.[0];
      return { kind: "edit", lines: [`A: cut the first ${fmt(Math.max(0, t - 0.25))} so the piece is on screen at 0.25s${pf != null ? ` (frame ${pf}, ${fmt(frameTime(pf))})` : ""}. Keep everything after.`, `B: the reel as posted (product at ${fmt(t)}).`, "Same caption, same audio, same length otherwise."], reels: asRole(cs, "edit for A, as is for B") };
    }
    case "price": {
      const cs = pick((c) => rep(c).price_on_screen_s == null, ["message"]);
      return { kind: "edit", lines: [`A: add the ₹ price as bold text on frame 1, bottom third, on screen for 2s. Use the real price of the piece.`, "B: the reel as posted, no price.", "Metric is link clicks, so both captions carry the wa.me link."], reels: cs.length ? asRole(cs, "edit for A, as is for B") : asRole(strong(cands, ["message"]).slice(0, 2), "remove price for B") };
    }
    case "telugu": {
      const cs = pick((c) => rep(c).telugu_text_s == null, ["message"]);
      const hook = cs[0]?.r.report?.hooks?.[0];
      return { kind: "edit", lines: [`A: Telugu line on screen from 1.0s to 3.5s${hook ? `, use the reel's own suggested hook: "${hook}"` : ""}.`, "B: the reel as posted.", "Keep the same audio; text only."], reels: cs.length ? asRole(cs, "edit for A, as is for B") : [] };
    }
    case "reason": {
      const cs = pick((c) => rep(c).reason_to_stay_s == null || rep(c).reason_to_stay_s! > 3, ["message"]);
      const occ = cs[0]?.r.report?.subject?.occasion;
      return { kind: "edit", lines: [`A: one line by second 3 giving a reason: ${occ ? `"${occ} ki perfect"` : "the occasion, a price claim, or a comparison"}.`, "B: the reel as posted.", "Text only, everything else identical."], reels: cs.length ? asRole(cs, "edit for A, as is for B") : [] };
    }
    case "richness": {
      const cs = pick((c) => (rep(c).richness?.score ?? 100) < 60 || (met(c).warmth ?? 0) > 35, ["richness", "light"]);
      const fix = cs[0]?.r.report?.richness?.fix;
      return { kind: "edit", lines: [`A: grade the same cut. CapCut or Premiere: temperature −15 to −25 until the metal reads neutral, contrast +10 to +15, highlights −10, saturation +5.${fix ? ` Claude's note on this reel: ${fix}` : ""}`, "B: the reel as posted.", "Do not re-cut; colour only."], reels: cs.length ? asRole(cs, "grade for A, as is for B") : [] };
    }
    case "length": {
      const cs = pick((c) => met(c).duration_s > 16, ["length"]);
      const c = cs[0]; const pfs = c ? rep(c).product_frames ?? [] : [];
      const start = pfs.length ? frameTime(pfs[0]) : 0;
      return { kind: "edit", lines: [`A: 11s cut. ${c ? `Start at ${fmt(Math.max(0, start - 0.25))}, keep the product-heavy stretch, end on a clean product frame.` : "Keep the product-heavy stretch."}`, `B: the full cut as posted${c ? ` (${met(c).duration_s}s)` : ""}.`, "Same opening frame in both."], reels: cs.length ? asRole(cs, "trim for A, as is for B") : [] };
    }
    case "pacing": {
      const cs = pick((c) => met(c).cuts_per_10s < 3, ["pacing"]);
      return { kind: "edit", lines: ["A: split every 2.5s and alternate a 5% punch-in on every other segment, so cuts land at 2.5, 5, 7.5, 10s.", "B: the reel as posted.", "Audio untouched."], reels: cs.length ? asRole(cs, "re-cut for A, as is for B") : [] };
    }
    case "cta": {
      const cs = strong(cands, ["caption"]).slice(0, 2);
      return { kind: "edit", lines: ["A: caption ends with \"WhatsApp: <number>\" and the wa.me link.", "B: same caption without the number and link.", "Identical video. Metric is link clicks."], reels: asRole(cs, "same video, two captions") };
    }
    default: {
      // Subject tests: find a pair of existing reels close in craft that differ on the variable.
      const on = (c: Candidate) => { const sub = rep(c).subject; if (!sub) return false; if (h.key === "deity") return sub.motif === "deity_temple"; if (h.key === "face") return sub.person === "face_visible"; if (h.key === "stones") return sub.colour === "coloured_stones"; return false; };
      const off = (c: Candidate) => { const sub = rep(c).subject; if (!sub) return false; if (h.key === "deity") return sub.motif !== "deity_temple" && sub.motif !== "other"; if (h.key === "face") return sub.person === "hands_only"; if (h.key === "stones") return sub.colour === "gold"; return false; };
      const A = cands.filter(on).sort((a, b) => (b.eng ?? 0) - (a.eng ?? 0)), B = cands.filter(off);
      let best: { a: Candidate; b: Candidate; d: number } | null = null;
      for (const a of A) for (const b of B) { const d = Math.abs(a.s.overall - b.s.overall) + Math.abs(a.s.richness - b.s.richness) / 2; if (!best || d < best.d) best = { a, b, d }; }
      if (best && best.d <= 15) return { kind: "pair", lines: [`Run these two as ads with the same audience and budget; they are within ${Math.round(best.d)} points on craft, so the difference is the subject.`, `A: ${best.a.r.name} (score ${best.a.s.overall}). B: ${best.b.r.name} (score ${best.b.s.overall}).`], reels: [{ id: best.a.r.id, name: best.a.r.name, role: "A" }, { id: best.b.r.id, name: best.b.r.name, role: "B" }] };
      return { kind: "shoot", lines: [`No matched pair in the library yet (${A.length} reels with ${h.a}, ${B.length} with ${h.b}). Shoot both on the same day: same set, same light, same model, same framing, only the piece changes.`, "Post both organically the same week, then boost both with the same audience and budget."], reels: asRole(A.slice(0, 1), "closest existing A") };
    }
  }
}
