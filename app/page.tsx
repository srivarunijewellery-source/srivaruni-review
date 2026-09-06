import Link from "next/link";
import { db, LIST_COLS, type Reel } from "@/lib/db";
import { DIMS, scoreDims, computeBar, tagFor, TAG_LABEL, rates, pearson, strength, label } from "@/lib/dimensions";
import Radar from "./radar";
import { fitModel } from "@/lib/model";

export const dynamic = "force-dynamic";

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "all" } = await searchParams;
  const { data } = await db().from("reels").select(LIST_COLS).is("competitor", null).order("created_at", { ascending: false }).limit(300);
  const reels = (data ?? []) as Reel[];
  const { bar, mid, n: barN, source } = computeBar(reels);
  const scored = reels.filter((r) => r.report && r.metrics).map((r) => ({ r, s: scoreDims(r.report!, r.metrics!, r.caption, r.frames?.length ?? 0), e: rates(r.insights, r.metrics!.duration_s) }));
  const withTag = scored.map((x) => ({ ...x, tag: tagFor(x.s, bar, mid) }));
  const posted = withTag.filter((x) => x.r.drive_file_id.startsWith("ig:"));
  const latest = withTag[0];
  const raising = withTag.length ? Math.round((100 * withTag.filter((x) => x.tag === "raises").length) / withTag.length) : 0;
  const organic = posted.filter((x) => x.e && !x.e.boosted);
  const saveRates = organic.map((x) => x.e!.saveRate);
  const pendingN = reels.filter((r) => r.status === "pending").length;

  // Which dimensions actually pay: median saves when a posted reel is at or above the bar on that dimension vs below.
  const lifts = organic.length >= 6 ? DIMS.map((d) => {
    const above = organic.filter((x) => x.s[d.key] >= bar[d.key]).map((x) => x.e!.saveRate);
    const below = organic.filter((x) => x.s[d.key] < bar[d.key]).map((x) => x.e!.saveRate);
    return { label: d.label, above: med(above), below: med(below), na: above.length, nb: below.length };
  }).filter((l) => l.na >= 2 && l.nb >= 2).sort((a, b) => (b.above - b.below) - (a.above - a.below)) : [];

  // Does the rubric predict engagement on this account? Correlation of each dimension with save rate and watch-through, organic only.
  const withWatch = organic.filter((x) => x.e!.watchThrough != null);
  const validation = DIMS.map((d) => ({
    label: d.label,
    saves: pearson(organic.map((x) => x.s[d.key]), organic.map((x) => x.e!.saveRate)),
    watch: pearson(withWatch.map((x) => x.s[d.key]), withWatch.map((x) => x.e!.watchThrough!)),
  }));
  const overallR = pearson(organic.map((x) => x.s.overall), organic.map((x) => x.e!.saveRate));
  const scatter = organic.map((x) => ({ x: x.s.overall, y: x.e!.saveRate, id: x.r.id }));
  const yMax = Math.max(10, ...scatter.map((p) => p.y));

  // What sells: engagement by what the reel shows, organic reels with a subject classification.
  const withSubject = organic.filter((x) => x.r.report!.subject);
  const groupBy = (key: "motif" | "piece" | "person" | "colour") => {
    const g = new Map<string, number[]>();
    for (const x of withSubject) { const k = x.r.report!.subject![key]; g.set(k, [...(g.get(k) ?? []), x.e!.saveRate]); }
    return [...g.entries()].map(([k, v]) => ({ k, n: v.length, med: med(v) })).filter((x) => x.n >= 2).sort((a, b) => b.med - a.med);
  };
  const sells = { motif: groupBy("motif"), piece: groupBy("piece"), person: groupBy("person"), colour: groupBy("colour") };
  const boostedReels = withTag.filter((x) => x.e?.boosted && x.r.insights?.ad_spend);
  const cpf = boostedReels.filter((x) => x.r.insights?.ad_cost_per_follow).map((x) => x.r.insights!.ad_cost_per_follow);

  // The equation: engagement ~ inputs, fitted on organic reels.
  const { fit, rows: modelRows } = fitModel(reels);
  const engById = new Map(modelRows.map((x) => [x.r.id, x.eng]));
  const predicted = (x: { r: Reel; s: ReturnType<typeof scoreDims> }) => (fit ? fit.predict(x.r, x.s) : null);

  const shown = withTag.filter((x) => view === "all" || (view === "instagram" ? x.r.drive_file_id.startsWith("ig:") : !x.r.drive_file_id.startsWith("ig:")));
  const queue = reels.filter((r) => !r.report && (view === "all" || (view === "instagram") === r.drive_file_id.startsWith("ig:")));

  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Reels analysed</small><b>{withTag.length}</b><span>{pendingN} waiting</span></div>
        <div className="kpi"><small>Your bar</small><b>{bar.overall}</b><span>p75 of {barN} {source === "instagram" ? "posted reels" : "reels"}</span></div>
        <div className="kpi"><small>Raising the bar</small><b>{raising}%</b><span>of analysed reels</span></div>
        <div className="kpi"><small>Model fit</small><b>{fit ? `R² ${fit.r2}` : "–"}</b><span>{fit ? `out-of-sample, ${fit.n} organic reels` : `needs 12 organic reels, have ${organic.length}`}</span></div>
      </div>

      <section className="hero">
        <div className="card radarcard">
          <div className="cardhead"><b>Latest vs your bar</b><span className="legend"><i style={{ background: "var(--gold)" }} />latest <i style={{ border: "1px dashed var(--plum)" }} />bar (p75)</span></div>
          {latest ? <Radar scores={latest.s} bar={bar} size={320} /> : <div className="empty small">Analyse a reel to see the radar.</div>}
          {latest && <div className="muted small">{latest.r.name}</div>}
        </div>
        <details className="card" open>
          <summary><b>The bar, by dimension</b><span className="muted small">p75 of your posted reels · white tick = latest</span></summary>
          <table className="dims">
            <tbody>
              {DIMS.map((d) => (
                <tr key={d.key}>
                  <td><b>{d.label}</b><div className="muted small">{d.help}</div></td>
                  <td className="num">{bar[d.key]}</td>
                  <td className="barcell"><div className="track"><div className="fill" style={{ width: `${bar[d.key]}%` }} />{latest && <div className="dot" style={{ left: `${latest.s[d.key]}%` }} />}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {lifts.length > 0 && (
            <>
              <div className="cardhead" style={{ marginTop: 18 }}><b>What earned saves</b><span className="muted small">saves per 1k views, at bar vs below, organic only</span></div>
              <table className="lifts"><tbody>{lifts.slice(0, 4).map((l) => <tr key={l.label}><td>{l.label}</td><td className="num up">{l.above}</td><td className="num">{l.below}</td></tr>)}</tbody></table>
            </>
          )}
        </details>
      </section>

      <details className="card" open={withSubject.length >= 6}>
        <summary><b>What sells</b><span className="muted small">saves per 1k views by what the reel shows · organic · {withSubject.length} reels</span></summary>
        {withSubject.length < 6 ? (
          <p className="muted">Needs 6 analysed organic reels with a subject read. Reels analysed before this update need “Re-analyze all”.</p>
        ) : (
          <div className="sells">
            {(["motif", "piece", "person", "colour"] as const).map((k) => (
              <table className="lifts" key={k}>
                <thead><tr><th>{k === "person" ? "Person" : k[0].toUpperCase() + k.slice(1)}</th><th className="num">saves/1k</th><th className="num">n</th></tr></thead>
                <tbody>{sells[k].map((x) => <tr key={x.k}><td>{label(x.k)}</td><td className="num">{x.med}</td><td className="num muted">{x.n}</td></tr>)}</tbody>
              </table>
            ))}
          </div>
        )}
        {boostedReels.length > 0 && (
          <div className="muted small" style={{ marginTop: 10 }}>
            Boosted: {boostedReels.length} reels, ₹{Math.round(boostedReels.reduce((a, x) => a + (x.r.insights!.ad_spend ?? 0), 0)).toLocaleString("en-IN")} spent{cpf.length ? `, median ₹${med(cpf)} per follow` : ""}.
          </div>
        )}
      </details>

      <details className="card" open={!!fit}>
        <summary><b>The equation: what drives engagement for Sri Varuni</b><span className="muted small">{fit ? `ridge regression, λ=${fit.lambda}, leave-one-out R² ${fit.r2}, n=${fit.n}` : `needs 12 analysed organic reels, have ${organic.length}`}</span></summary>
        {fit ? (
          <div className="validation">
            <div>
              <div className="cardhead"><b>Drivers</b><span className="muted small">standardised effect on engagement score</span></div>
              <table className="lifts">
                <thead><tr><th>Input</th><th className="num">Effect</th><th className="num">r</th></tr></thead>
                <tbody>{fit.drivers.slice(0, 10).map((d) => <tr key={d.key}><td>{d.label}</td><td className={`num ${d.coef > 0 ? "up" : "down"}`}>{d.coef > 0 ? "+" : ""}{Math.round(d.coef)}</td><td className="num muted">{d.r ?? "–"}</td></tr>)}</tbody>
              </table>
              <p className="muted small" style={{ marginTop: 8 }}>Effect = change in engagement score per one standard deviation of the input, all others held. r = simple correlation. Read {fit.r2 < 0.2 ? "with caution: the fit is weak, keep adding reels" : fit.r2 < 0.5 ? "as directional: the trend is real, the sizes are rough" : "with confidence"}.</p>
            </div>
            <div>
              <div className="cardhead"><b>Rubric weights</b><span className="muted small">manual vs learned from your reels</span></div>
              <table className="lifts">
                <thead><tr><th>Dimension</th><th className="num">Manual</th><th className="num">Learned</th></tr></thead>
                <tbody>{DIMS.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num muted">{Math.round(d.weight * 100)}%</td><td className="num">{Math.round((fit.learnedWeights[d.key] ?? 0) * 100)}%</td></tr>)}</tbody>
              </table>
              <p className="muted small" style={{ marginTop: 8 }}>Learned weights are the positive regression coefficients on the eight dimensions, normalised. When they stabilise across a few weeks, they replace the manual ones in <code>lib/dimensions.ts</code>.</p>
            </div>
          </div>
        ) : (
          <p className="muted">Press Analyze and let it run. The regression switches on at 12 organic reels and gets sharper with every one after.</p>
        )}
      </details>

      <details className="card" open={organic.length >= 8 && !fit}>
        <summary><b>Does the score predict engagement?</b><span className="muted small">{organic.length} organic reels · overall score vs save rate: {overallR ?? "n/a"} ({strength(overallR)})</span></summary>
        {organic.length < 8 ? (
          <p className="muted">Needs at least 8 analysed organic reels. Press Analyze and let it run; this panel fills in by itself.</p>
        ) : (
          <div className="validation">
            <svg viewBox="0 0 320 200" className="scatter" role="img" aria-label="Score vs save rate">
              <line x1="36" y1="170" x2="310" y2="170" stroke="var(--line-2)" /><line x1="36" y1="10" x2="36" y2="170" stroke="var(--line-2)" />
              <text x="173" y="192" fontSize="10" fill="var(--muted)" textAnchor="middle">overall score</text>
              <text x="12" y="90" fontSize="10" fill="var(--muted)" textAnchor="middle" transform="rotate(-90 12 90)">saves / 1k views</text>
              {scatter.map((p) => <circle key={p.id} cx={36 + (p.x / 100) * 274} cy={170 - (p.y / yMax) * 160} r="4" fill="var(--maroon)" opacity="0.75" />)}
            </svg>
            <table className="lifts">
              <thead><tr><th>Dimension</th><th className="num">vs saves</th><th className="num">vs watch</th><th>Read</th></tr></thead>
              <tbody>{validation.map((v) => <tr key={v.label}><td>{v.label}</td><td className="num">{v.saves ?? "–"}</td><td className="num">{v.watch ?? "–"}</td><td className="muted small">{strength(v.saves)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </details>

      <div className="tabs">
        {[["all", "All"], ["instagram", "Posted on Instagram"], ["drafts", "Drive drafts"]].map(([k, l]) => <Link key={k} href={`/?view=${k}`} className={view === k ? "on" : ""}>{l}</Link>)}
      </div>

      {shown.length === 0 && queue.length === 0 ? (
        <div className="empty">Nothing here yet. Import from Instagram, then press Analyze.</div>
      ) : (
        <div className="grid">
          {shown.map(({ r, s, tag, e }) => {
            const thumb = r.thumb;
            return (
              <Link className="tile" key={r.id} href={`/reel/${r.id}`}>
                <div className="tilehead">
                  {thumb ? <img src={thumb} alt="" /> : <div className="thumb" />}
                  <div className="mini"><Radar scores={s} bar={bar} size={120} labels={false} /></div>
                </div>
                <div className="tilebody">
                  <div className="tiletitle">{r.name}</div>
                  <div className="tagrow"><div className={`tag ${tag}`}>{TAG_LABEL[tag]}</div>{e?.boosted && <div className="tag boosted">Boosted</div>}{r.report?.subject && <div className="tag subject">{label(r.report.subject.motif)}</div>}</div>
                  <div className="tilefacts"><span><b>{s.overall}</b> score</span>{engById.has(r.id) && <span><b>{engById.get(r.id)}</b> engagement</span>}{fit && !engById.has(r.id) && <span><b>{predicted({ r, s })}</b> predicted</span>}{e?.watchThrough != null && <span><b>{e.watchThrough}%</b> watched</span>}</div>
                </div>
              </Link>
            );
          })}
          {queue.map((r) => (
            <Link className={`tile queued ${r.status}`} key={r.id} href={`/reel/${r.id}`}>
              <div className="tilebody">
                <div className="tiletitle">{r.name}</div>
                <div className={`tag ${r.status}`}>{r.status === "pending" ? "Waiting for Analyze" : r.status === "processing" ? <><span className="spin" />Analysing</> : r.status === "paused" ? "Paused" : r.status === "error" ? "Skipped" : "Fix"}</div>
                {r.error && <div className="muted small">{r.error.slice(0, 120)}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
