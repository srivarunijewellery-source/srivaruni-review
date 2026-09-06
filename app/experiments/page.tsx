import Link from "next/link";
import { db, LIST_COLS, type Reel } from "@/lib/db";
import { computeBar, scoreDims } from "@/lib/dimensions";
import { fitModel, FEATURES } from "@/lib/model";
import { HYPOTHESES, evidence, viewsPerArm, verdict, finalVerdict, planFor, PLAN_FOOTER, type MarkRow, type Candidate } from "@/lib/hypotheses";
import Ticket from "../ticket";
import { adRows, metaReady, type AdRow } from "@/lib/meta";

export const dynamic = "force-dynamic";
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;

type Exp = { id: string; hypothesis: string; variant_a: string; variant_b: string; ad_id_a: string | null; ad_id_b: string | null; metric: string; status: string; result: { a: { spend: number; impressions: number; k: number }; b: { spend: number; impressions: number; k: number }; test: { z: number; p: number; lift: number | null; rateA: number; rateB: number } | null } | null; notes: string | null; created_at: string };

export default async function Experiments({ searchParams }: { searchParams: Promise<{ plan?: string; err?: string }> }) {
  const { plan, err } = await searchParams;
  const sb = db();
  const [{ data: rd }, { data: xd }, { data: md }, ads] = await Promise.all([
    sb.from("reels").select(LIST_COLS).is("competitor", null).order("created_at", { ascending: false }).limit(300),
    sb.from("experiments").select("*").order("created_at", { ascending: false }),
    sb.from("hypothesis_marks").select("*"),
    metaReady() ? adRows().catch(() => [] as AdRow[]) : Promise.resolve([] as AdRow[]),
  ]);
  const marks = new Map(((md ?? []) as MarkRow[]).map((m) => [m.key, m]));
  const reels = (rd ?? []) as Reel[];
  const exps = (xd ?? []) as Exp[];
  const { fit, rows } = fitModel(reels);
  const { bar } = computeBar(reels);

  // How often each dummy is "on" among organic reels: a variable with under 5 positives has no clarity whatever the model says.
  const groupCounts: Record<string, number> = {};
  for (const f of FEATURES) if (["price", "telugu", "reason", "deity", "bridal", "face", "hands", "stones"].includes(f.key)) groupCounts[f.key] = rows.filter((x) => f.get(x.r, x.s) === 1).length;
  const ev = evidence(fit, groupCounts);

  // Baseline organic save rate per view and the ad account's CPM: they size every test.
  const organic = rows.map((x) => x.e);
  const baseline = organic.length ? med(organic.map((e) => e.saveRate)) / 1000 : 0.01;
  const spent = ads.filter((a) => a.spend > 0);
  const cpm = spent.length ? (spent.reduce((a, b) => a + b.spend, 0) / Math.max(1, spent.reduce((a, b) => a + b.impressions, 0))) * 1000 : 60;
  const perArm = viewsPerArm(baseline || 0.01, 0.3);
  const budgetPerArm = (perArm / 1000) * cpm;

  // Verdicts from logged experiments, then priority = impact × uncertainty.
  const byHyp = new Map<string, Exp[]>();
  for (const x of exps) byHyp.set(x.hypothesis, [...(byHyp.get(x.hypothesis) ?? []), x]);
  const table = HYPOTHESES.map((h) => {
    const e = ev.find((v) => v.key === h.key)!;
    const reads = (byHyp.get(h.key) ?? []).filter((x) => x.result?.test).map((x) => ({ p: x.result!.test!.p, lift: x.result!.test!.lift }));
    const v = finalVerdict(verdict(reads), marks.get(h.key)?.mark);
    const impact = e.clarity === "no clarity" ? 10 : Math.abs(e.coef ?? (e.r ?? 0) * 20);
    const unc = v === "untested" ? 1 : v === "retest" ? 1.1 : v === "one read" ? 0.6 : v === "inconclusive" ? 0.8 : 0.1;
    const priority = Math.round(impact * (e.clarity === "no clarity" ? 1.3 : unc));
    return { h, e, v, reads: reads.length, priority, planned: (byHyp.get(h.key) ?? []).filter((x) => x.status !== "read").length, mark: marks.get(h.key) };
  }).sort((a, b) => b.priority - a.priority);

  // Lab plans from the library: candidates are scored reels with an engagement read where available.
  const engById = new Map(rows.map((x) => [x.r.id, x.eng]));
  const cands: Candidate[] = reels.filter((r) => r.report && r.metrics).map((r) => ({ r, s: scoreDims(r.report!, r.metrics!, r.caption), eng: engById.get(r.id) ?? null }));

  // Ads overview: per reel.
  const reelByMedia = new Map(reels.filter((r) => r.ig_media_id).map((r) => [r.ig_media_id!, r]));
  const perReel = new Map<string, { reel: Reel | undefined; spend: number; imp: number; saves: number; clicks: number; follows: number; ads: number }>();
  for (const a of ads) {
    const key = a.mediaId ?? `ad:${a.id}`;
    const cur = perReel.get(key) ?? { reel: a.mediaId ? reelByMedia.get(a.mediaId) : undefined, spend: 0, imp: 0, saves: 0, clicks: 0, follows: 0, ads: 0 };
    cur.spend += a.spend; cur.imp += a.impressions; cur.ads++;
    cur.saves += Object.entries(a.actions).find(([k]) => /post_save|^save$/i.test(k))?.[1] ?? 0;
    cur.clicks += a.actions.link_click ?? 0;
    cur.follows += Object.entries(a.actions).find(([k]) => /follow/i.test(k))?.[1] ?? 0;
    perReel.set(key, cur);
  }
  const adReels = [...perReel.values()].filter((x) => x.spend > 0);
  const totalSpend = adReels.reduce((a, x) => a + x.spend, 0);
  const withSaves = adReels.filter((x) => x.saves > 0).map((x) => ({ ...x, cps: x.spend / x.saves })).sort((a, b) => a.cps - b.cps);
  const noResult = adReels.filter((x) => x.saves === 0 && x.clicks === 0 && x.follows === 0);

  // Acceptance rules: hard once a hypothesis is supported, advisory from the bar otherwise.
  const supported = new Set(table.filter((t) => t.v === "supported").map((t) => t.h.key));
  const rejected = new Set(table.filter((t) => t.v === "rejected").map((t) => t.h.key));
  const rules = [
    { key: "ttp", rule: `Jewellery fills the frame within ${Math.max(0.5, +((100 - bar.hook) / 33).toFixed(1))}s` },
    { key: "price", rule: "₹ price as text on the first frame" },
    { key: "telugu", rule: "Telugu line on screen by second 3" },
    { key: "reason", rule: "Occasion or comparison line by second 3" },
    { key: "richness", rule: "Neutral white balance, no yellow cast, hard key light for sparkle" },
    { key: "length", rule: "7 to 15 seconds" },
    { key: "pacing", rule: "Angle change every 2 to 3 seconds" },
    { key: "cta", rule: "Caption ends with the WhatsApp number, five hashtags" },
  ];
  const planHyp = HYPOTHESES.find((h) => h.key === plan);

  return (
    <>
      <h1>Experiments</h1>
      <p className="muted">History says where to look. Ads say what is true. A hypothesis becomes a rule only after it replicates: two reads in the same direction at p&lt;0.1, or one at p&lt;0.01.</p>
      {err === "ids" && <p style={{ color: "var(--fix)" }}>Both ad IDs are needed before a result can be read.</p>}
      <nav className="subnav"><a href="#roadmap">Roadmap</a><a href="#hyps">Hypotheses</a><a href="#rules">Rules</a><a href="#ads">Ads</a><a href="#plan">Log a test</a></nav>

      <div className="kpis">
        <div className="kpi"><small>Ad spend to date</small><b>{inr(totalSpend)}</b><span>{adReels.length} boosted reels, {ads.length} ads</span></div>
        <div className="kpi"><small>Median cost per save</small><b>{withSaves.length ? inr(med(withSaves.map((x) => x.cps))) : "–"}</b><span>across boosted reels</span></div>
        <div className="kpi"><small>Views per arm</small><b>{perArm.toLocaleString("en-IN")}</b><span>to detect a 30% lift on a {(baseline * 100).toFixed(2)}% save rate</span></div>
        <div className="kpi"><small>Budget per test</small><b>{inr(budgetPerArm * 2)}</b><span>two arms at your CPM of {inr(cpm)}</span></div>
      </div>

      <details className="card" open id="hyps">
        <summary><b>Hypotheses</b><span className="muted small">ranked by impact × uncertainty · {table.filter((t) => t.v === "untested").length} untested · {table.filter((t) => t.e.clarity === "no clarity").length} with no clarity</span></summary>
        <table className="lifts">
          <thead><tr><th>Variable</th><th>Claim</th><th>History says</th><th>Verdict</th><th className="num">Priority</th><th>Your mark</th></tr></thead>
          <tbody>
            {table.map(({ h, e, v, reads, priority, planned, mark }) => (
              <tr key={h.key}>
                <td><b>{h.variable}</b></td>
                <td className="small">{h.claim}</td>
                <td className="small">
                  <span className={`tag ${e.clarity === "no clarity" ? "pending" : e.direction === "supports" ? "raises" : e.direction === "against" ? "below" : "meets"}`}>{e.clarity === "no clarity" ? "no clarity" : `${e.direction}, ${e.clarity}`}</span>
                  {e.r != null && <div className="muted">r {e.r}{e.coef != null ? ` · effect ${e.coef > 0 ? "+" : ""}${Math.round(e.coef)}` : ""}</div>}
                </td>
                <td className="small"><span className={`tag ${v === "supported" ? "raises" : v === "rejected" ? "below" : v === "untested" ? "error" : "meets"}`}>{v}</span>{reads > 0 && <div className="muted">{reads} read{reads > 1 ? "s" : ""}</div>}{planned > 0 && <div className="muted">{planned} planned</div>}</td>
                <td className="num">{priority}</td>
                <td>
                  <form action="/api/hypotheses" method="post" className="inline markform">
                    <input type="hidden" name="key" value={h.key} />
                    <select name="mark" defaultValue={mark?.mark ?? "unknown"}><option value="unknown">unknown</option><option value="supported">supported</option><option value="rejected">rejected</option><option value="retest">retest</option></select>
                    <input type="text" name="note" placeholder="why" defaultValue={mark?.note ?? ""} />
                    <button type="submit" className="ghost small">Mark</button>
                  </form>
                  <Link className="small" href={`/experiments?plan=${h.key}#plan`}>Plan test →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <section id="roadmap">
        <h2>Roadmap: next six tests</h2>
        <p className="muted small">Each ticket names the reel, the exact edit for the editor, and how to read it. Same audience, same budget, same week, one variable changed.</p>
        <div className="tickets">
          {table.filter((t) => t.v !== "supported" && t.v !== "rejected").slice(0, 6).map(({ h, priority }) => (
            <Ticket key={h.key} variable={h.variable} priority={priority} budget={inr(budgetPerArm * 2)} views={perArm.toLocaleString("en-IN")} plan={planFor(h, cands)} planKey={h.key} footer={PLAN_FOOTER} />
          ))}
        </div>
      </section>

      <details className="card" open id="rules">
        <summary><b>What we accept</b><span className="muted small">hard rules are proven; advisory rules come from the bar</span></summary>
        <div className="validation">
          <div>
            <div className="cardhead"><b>Hard rules</b><span className="muted small">a reel that misses these is not posted</span></div>
            {rules.filter((r) => supported.has(r.key)).length === 0 ? <p className="muted">None proven yet. Every rule below is advisory until its test replicates.</p> : <ul className="brief">{rules.filter((r) => supported.has(r.key)).map((r) => <li key={r.key}>{r.rule}</li>)}</ul>}
          </div>
          <div>
            <div className="cardhead"><b>Advisory</b><span className="muted small">from the bar and from history</span></div>
            <ul className="brief">{rules.filter((r) => !supported.has(r.key) && !rejected.has(r.key)).map((r) => <li key={r.key}>{r.rule}</li>)}</ul>
            {rejected.size > 0 && <><div className="cardhead" style={{ marginTop: 10 }}><b>Dropped</b></div><ul className="brief">{rules.filter((r) => rejected.has(r.key)).map((r) => <li key={r.key} className="muted">{r.rule}</li>)}</ul></>}
          </div>
        </div>
      </details>

      <details className="card" open={adReels.length > 0} id="ads">
        <summary><b>What the ads say</b><span className="muted small">{metaReady() ? `${ads.length} ads read from Meta` : "add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID"}</span></summary>
        {adReels.length === 0 ? <p className="muted">No ad spend found on this account yet.</p> : (
          <div className="validation">
            <div>
              <div className="cardhead"><b>Cheapest saves</b></div>
              <table className="lifts"><tbody>{withSaves.slice(0, 5).map((x, i) => <tr key={i}><td>{x.reel ? <Link href={`/reel/${x.reel.id}`}>{x.reel.name}</Link> : <span className="muted">reel not imported</span>}</td><td className="num">{inr(x.cps)}</td><td className="num muted">{inr(x.spend)}</td></tr>)}</tbody></table>
              <div className="cardhead" style={{ marginTop: 12 }}><b>Most expensive saves</b></div>
              <table className="lifts"><tbody>{withSaves.slice(-5).reverse().map((x, i) => <tr key={i}><td>{x.reel ? <Link href={`/reel/${x.reel.id}`}>{x.reel.name}</Link> : <span className="muted">reel not imported</span>}</td><td className="num">{inr(x.cps)}</td><td className="num muted">{inr(x.spend)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <div className="cardhead"><b>Spend with no result</b><span className="muted small">{inr(noResult.reduce((a, x) => a + x.spend, 0))}</span></div>
              {noResult.length === 0 ? <p className="muted">Every boosted reel produced at least one save, click or follow.</p> : <table className="lifts"><tbody>{noResult.slice(0, 8).map((x, i) => <tr key={i}><td>{x.reel ? <Link href={`/reel/${x.reel.id}`}>{x.reel.name}</Link> : <span className="muted">reel not imported</span>}</td><td className="num">{inr(x.spend)}</td><td className="num muted">{x.imp.toLocaleString("en-IN")} imp</td></tr>)}</tbody></table>}
              <p className="muted small" style={{ marginTop: 10 }}>Read cost per save against the reel's rubric score and subject on its page. When cheap saves cluster on one motif or one craft trait, that is the next hypothesis to test.</p>
            </div>
          </div>
        )}
      </details>

      <details className="card" open id="plan">
        <summary><b>Log a test</b><span className="muted small">plan first, add the two ad IDs once the ads run, read the result here</span></summary>
        <form className="expform" action="/api/experiments" method="post">
          <label>Hypothesis<select name="hypothesis" defaultValue={planHyp?.key ?? HYPOTHESES[0].key}>{HYPOTHESES.map((h) => <option key={h.key} value={h.key}>{h.variable}</option>)}</select></label>
          <label>Metric<select name="metric" defaultValue={planHyp?.metric ?? "saves"}><option value="saves">saves</option><option value="link_clicks">link clicks (WhatsApp)</option><option value="follows">follows</option><option value="engagement">post engagement</option></select></label>
          <label>Variant A<input type="text" name="variant_a" defaultValue={planHyp?.a ?? ""} required /></label>
          <label>Variant B<input type="text" name="variant_b" defaultValue={planHyp?.b ?? ""} required /></label>
          <label>Ad ID A<input type="text" name="ad_id_a" placeholder="from Ads Manager, optional now" /></label>
          <label>Ad ID B<input type="text" name="ad_id_b" placeholder="from Ads Manager, optional now" /></label>
          <label className="wide">Notes<input type="text" name="notes" placeholder="audience, budget, dates" /></label>
          <button type="submit">Save test</button>
        </form>
        {exps.length > 0 && (
          <table className="lifts" style={{ marginTop: 16 }}>
            <thead><tr><th>Test</th><th>A vs B</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {exps.map((x) => {
                const h = HYPOTHESES.find((k) => k.key === x.hypothesis);
                const t = x.result?.test;
                return (
                  <tr key={x.id}>
                    <td><b>{h?.variable ?? x.hypothesis}</b><div className="muted small">{x.metric.replace("_", " ")} · {new Date(x.created_at).toLocaleDateString("en-IN")}</div></td>
                    <td className="small">{x.variant_a} <span className="muted">vs</span> {x.variant_b}{x.notes && <div className="muted">{x.notes}</div>}</td>
                    <td className="small">{t ? <><span className={`tag ${t.p < 0.1 ? (t.lift! > 0 ? "raises" : "below") : "meets"}`}>{t.lift != null ? `${t.lift > 0 ? "+" : ""}${t.lift}%` : "–"} · p {t.p}</span><div className="muted">A {x.result!.a.k}/{x.result!.a.impressions.toLocaleString("en-IN")} · B {x.result!.b.k}/{x.result!.b.impressions.toLocaleString("en-IN")}</div></> : x.result ? <span className="muted">too few impressions to read</span> : <span className={`tag ${x.status}`}>{x.status}</span>}</td>
                    <td>
                      <form action={`/api/experiments/${x.id}/read`} method="post" className="inline">
                        {!x.ad_id_a && <input type="text" name="ad_id_a" placeholder="Ad ID A" />}
                        {!x.ad_id_b && <input type="text" name="ad_id_b" placeholder="Ad ID B" />}
                        <button type="submit" className="ghost small">{x.result ? "Re-read" : "Read result"}</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </details>
    </>
  );
}
