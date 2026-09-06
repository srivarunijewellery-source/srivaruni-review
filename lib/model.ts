import type { Reel } from "./db";
import { DIMS, scoreDims, rates, type Scores, type Rates } from "./dimensions";

// ---------- Engagement score: the output variable ----------
// Rates standardised across organic reels, combined (saves and watch-through carry most weight), then percentile-ranked to 0-100.
const ENG_W = { saveRate: 0.4, watchThrough: 0.3, shareRate: 0.15, commentRate: 0.15 } as const;

export type Row = { r: Reel; s: Scores; e: Rates; eng: number; x: number[] };

function zscores(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1;
  return xs.map((x) => (x == null ? 0 : (x - m) / sd));
}

export function engagementScores(rows: { e: Rates }[]): number[] {
  const z = {
    saveRate: zscores(rows.map((r) => r.e.saveRate)),
    watchThrough: zscores(rows.map((r) => r.e.watchThrough)),
    shareRate: zscores(rows.map((r) => r.e.shareRate)),
    commentRate: zscores(rows.map((r) => r.e.commentRate)),
  };
  const raw = rows.map((_, i) => (Object.keys(ENG_W) as (keyof typeof ENG_W)[]).reduce((a, k) => a + ENG_W[k] * z[k][i], 0));
  const sorted = [...raw].sort((a, b) => a - b);
  return raw.map((v) => Math.round((100 * sorted.findIndex((x) => x >= v)) / Math.max(1, sorted.length - 1)));
}

// ---------- Features: the input variables ----------
export const FEATURES: { key: string; label: string; get: (r: Reel, s: Scores) => number }[] = [
  ...DIMS.map((d) => ({ key: d.key, label: d.label, get: (_r: Reel, s: Scores) => s[d.key] })),
  { key: "ttp", label: "Time to product (s)", get: (r) => Math.min(6, r.report!.time_to_product_s ?? 6) },
  { key: "sharp", label: "Sharpness raw", get: (r) => r.metrics!.sharpness },
  { key: "cuts", label: "Cuts per 10s", get: (r) => r.metrics!.cuts_per_10s },
  { key: "bright", label: "Brightness", get: (r) => r.metrics!.brightness },
  { key: "warmth", label: "Yellow cast", get: (r) => r.metrics!.warmth ?? 0 },
  { key: "sparkle", label: "Sparkle %", get: (r) => r.metrics!.sparkle ?? 0 },
  { key: "contrast", label: "Contrast", get: (r) => r.metrics!.contrast ?? 0 },
  { key: "richjudged", label: "Richness (judged)", get: (r) => r.report!.richness?.score ?? 50 },
  { key: "dur", label: "Duration (s)", get: (r) => r.metrics!.duration_s },
  { key: "price", label: "Price shown", get: (r) => (r.report!.price_on_screen_s != null ? 1 : 0) },
  { key: "telugu", label: "Telugu shown", get: (r) => (r.report!.telugu_text_s != null ? 1 : 0) },
  { key: "reason", label: "Reason to stay shown", get: (r) => (r.report!.reason_to_stay_s != null ? 1 : 0) },
  { key: "deity", label: "Deity / temple motif", get: (r) => (r.report!.subject?.motif === "deity_temple" ? 1 : 0) },
  { key: "bridal", label: "Bridal heavy motif", get: (r) => (r.report!.subject?.motif === "bridal_heavy" ? 1 : 0) },
  { key: "face", label: "Face visible", get: (r) => (r.report!.subject?.person === "face_visible" ? 1 : 0) },
  { key: "hands", label: "Hands only", get: (r) => (r.report!.subject?.person === "hands_only" ? 1 : 0) },
  { key: "stones", label: "Coloured stones", get: (r) => (r.report!.subject?.colour === "coloured_stones" ? 1 : 0) },
];

// ---------- Ridge regression with leave-one-out CV ----------
function solve(A: number[][], b: number[]): number[] {
  const n = A.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row) => row[n]);
}

function ridge(X: number[][], y: number[], lambda: number) {
  const p = X[0].length, XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  for (let a = 0; a < p; a++) XtX[a][a] += lambda;
  return solve(XtX, Xty);
}

export type Fit = {
  n: number; r2: number; lambda: number;
  drivers: { key: string; label: string; coef: number; r: number | null }[];
  learnedWeights: Record<string, number>;
  predict: (r: Reel, s: Scores) => number;
};

function standardise(cols: number[][]) {
  const means = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const sds = cols.map((c, j) => Math.sqrt(c.reduce((a, b) => a + (b - means[j]) ** 2, 0) / c.length) || 1);
  return { means, sds };
}

function corr(x: number[], y: number[]) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(2) : null;
}

/** Fit engagement ~ features on organic reels. Returns null below 12 reels: anything fitted on less is noise dressed as science. */
export function fitModel(reels: Reel[]): { fit: Fit | null; rows: Row[] } {
  const organic = reels.filter((r) => r.report && r.metrics && r.drive_file_id.startsWith("ig:") && r.insights && !r.insights.boosted);
  const base = organic.map((r) => { const s = scoreDims(r.report!, r.metrics!, r.caption, r.frames?.length ?? 0); return { r, s, e: rates(r.insights, r.metrics!.duration_s)! }; }).filter((x) => x.e && x.e.views > 0);
  const eng = engagementScores(base);
  const rows: Row[] = base.map((b, i) => ({ ...b, eng: eng[i], x: FEATURES.map((f) => f.get(b.r, b.s)) }));
  if (rows.length < 12) return { fit: null, rows };

  // Drop constant features (e.g. no deity reels yet) so the design matrix stays sane.
  const active = FEATURES.map((_, j) => new Set(rows.map((r) => r.x[j])).size > 1);
  const cols = FEATURES.map((_, j) => rows.map((r) => r.x[j]));
  const { means, sds } = standardise(cols);
  const X = rows.map((r) => [1, ...FEATURES.map((_, j) => (active[j] ? (r.x[j] - means[j]) / sds[j] : 0))]);
  const y = rows.map((r) => r.eng);
  const ym = y.reduce((a, b) => a + b, 0) / y.length, sst = y.reduce((a, b) => a + (b - ym) ** 2, 0);

  // Leave-one-out CV over a lambda grid; pick the lambda that predicts held-out reels best.
  let best = { lambda: 1, r2: -Infinity };
  for (const lambda of [0.5, 1, 2, 4, 8, 16, 32]) {
    let sse = 0;
    for (let i = 0; i < X.length; i++) {
      const Xi = X.filter((_, k) => k !== i), yi = y.filter((_, k) => k !== i);
      const w = ridge(Xi, yi, lambda);
      const pred = X[i].reduce((a, v, j) => a + v * w[j], 0);
      sse += (y[i] - pred) ** 2;
    }
    const r2 = 1 - sse / sst;
    if (r2 > best.r2) best = { lambda, r2 };
  }
  const w = ridge(X, y, best.lambda);
  const drivers = FEATURES.map((f, j) => ({ key: f.key, label: f.label, coef: active[j] ? +w[j + 1].toFixed(1) : 0, r: active[j] ? corr(cols[j], y) : null }))
    .filter((d) => d.coef !== 0).sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));

  // Learned rubric weights: positive coefficients on the eight dimensions, normalised. Negative or absent stays 0.
  const dimCoefs = DIMS.map((d, j) => Math.max(0, w[j + 1]));
  const sum = dimCoefs.reduce((a, b) => a + b, 0) || 1;
  const learnedWeights = Object.fromEntries(DIMS.map((d, j) => [d.key, +(dimCoefs[j] / sum).toFixed(2)]));

  const predict = (r: Reel, s: Scores) => {
    const x = FEATURES.map((f) => f.get(r, s));
    const v = w[0] + FEATURES.reduce((a, _, j) => a + (active[j] ? ((x[j] - means[j]) / sds[j]) * w[j + 1] : 0), 0);
    return Math.round(Math.max(0, Math.min(100, v)));
  };
  return { fit: { n: rows.length, r2: +Math.max(-1, best.r2).toFixed(2), lambda: best.lambda, drivers, learnedWeights, predict }, rows };
}
