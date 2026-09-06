import Link from "next/link";
import { db, LIST_COLS, type Reel } from "@/lib/db";
import { DIMS, scoreDims, computeBar, rates, label } from "@/lib/dimensions";
import { fitModel } from "@/lib/model";
import { HYPOTHESES, type MarkRow } from "@/lib/hypotheses";
import Radar from "../radar";

export const dynamic = "force-dynamic";

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export default async function NextReel() {
  const sb = db();
  const [{ data, error }, { data: md }] = await Promise.all([sb.from("reels").select(LIST_COLS).is("competitor", null).order("created_at", { ascending: false }).limit(300), sb.from("hypothesis_marks").select("*")]);
  const reels = (data ?? []) as Reel[];
  if (error) return <div className="empty" style={{ color: "var(--fix)" }}>Database query failed: {error.message}. Run the pending SQL in supabase/schema.sql and reload.</div>;
  const marks = new Map(((md ?? []) as MarkRow[]).map((m) => [m.key, m]));
  const proven = HYPOTHESES.filter((h) => marks.get(h.key)?.mark === "supported");
  const dropped = HYPOTHESES.filter((h) => marks.get(h.key)?.mark === "rejected");
  const mark = (k: string) => marks.get(k)?.mark;
  const { bar, n: barN } = computeBar(reels);
  const scored = reels.filter((r) => r.report && r.metrics).map((r) => ({ r, s: scoreDims(r.report!, r.metrics!, r.caption, r.frames?.length ?? 0), e: rates(r.insights, r.metrics!.duration_s) }));
  const organic = scored.filter((x) => x.r.drive_file_id.startsWith("ig:") && x.e && !x.e.boosted);
  const { fit, rows } = fitModel(reels);
  const engById = new Map(rows.map((x) => [x.r.id, x.eng]));

  // Where your recent work sits against the bar: biggest gaps first.
  const recent = scored.slice(0, 10);
  const gaps = DIMS.map((d) => ({ d, median: med(recent.map((x) => x.s[d.key])), bar: bar[d.key] })).map((g) => ({ ...g, gap: g.bar - g.median })).sort((a, b) => b.gap - a.gap);
  const recentMedian = Object.fromEntries([...DIMS.map((d) => [d.key, med(recent.map((x) => x.s[d.key]))]), ["overall", med(recent.map((x) => x.s.overall))]]) as typeof bar;

  // What to shoot: best-performing subject on each axis, organic reels only.
  const withSubject = organic.filter((x) => x.r.report!.subject);
  const best = (key: "motif" | "piece" | "person" | "colour") => {
    const g = new Map<string, number[]>();
    for (const x of withSubject) { const k = x.r.report!.subject![key]; g.set(k, [...(g.get(k) ?? []), engById.get(x.r.id) ?? x.e!.saveRate]); }
    const rows = [...g.entries()].map(([k, v]) => ({ k, n: v.length, med: med(v) })).filter((x) => x.n >= 2).sort((a, b) => b.med - a.med);
    return rows[0] ? { ...rows[0], runnerUp: rows[1] } : null;
  };
  const shoot = { motif: best("motif"), piece: best("piece"), person: best("person"), colour: best("colour") };
  const occasions = withSubject.map((x) => x.r.report!.subject!.occasion).filter(Boolean) as string[];

  // Recurring richness issues on recent reels, with the most recent fix Claude wrote for each.
  const issueCount = new Map<string, { n: number; fix: string | null }>();
  for (const x of scored.slice(0, 20)) for (const i of x.r.report!.richness?.issues ?? []) { const cur = issueCount.get(i) ?? { n: 0, fix: null }; issueCount.set(i, { n: cur.n + 1, fix: cur.fix ?? x.r.report!.richness?.fix ?? null }); }
  const issues = [...issueCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);

  // Reference reels: your own top performers, organic.
  const top = [...organic].sort((a, b) => (engById.get(b.r.id) ?? 0) - (engById.get(a.r.id) ?? 0)).slice(0, 3);
  const drivers = fit ? fit.drivers.filter((d) => d.coef > 0).slice(0, 5) : [];
  const avoid = fit ? fit.drivers.filter((d) => d.coef < 0).slice(0, 4) : [];
  const enough = scored.length >= 6;

  return (
    <>
      <h1>The next reel</h1>
      <p className="muted">A brief built from your own reels: what to shoot, how to shoot it, and what it must beat. Updates every time a reel is analysed.</p>

      {!enough ? (
        <div className="empty">Analyse at least 6 reels and this page writes itself.</div>
      ) : (
        <>
          <section className="hero">
            <div className="card radarcard">
              <div className="cardhead"><b>Recent work vs the bar</b><span className="legend"><i style={{ background: "var(--gold)" }} />last 10 <i style={{ border: "1px dashed var(--plum)" }} />bar</span></div>
              <Radar scores={recentMedian} bar={bar} size={300} />
              <div className="muted small">Bar is p75 of {barN} reels. Close the widest gaps first.</div>
            </div>
            <div className="card">
              <div className="cardhead"><b>Shoot this</b><span className="muted small">{withSubject.length} organic reels with a subject read</span></div>
              {withSubject.length < 6 ? <p className="muted">Needs 6 organic reels with a subject read (Re-score all if they were analysed earlier).</p> : (
                <table className="lifts"><tbody>
                  {(["motif", "piece", "person", "colour"] as const).map((k) => shoot[k] && (
                    <tr key={k}><td className="muted">{k === "person" ? "In frame" : k[0].toUpperCase() + k.slice(1)}</td><td><b>{label(shoot[k]!.k)}</b> <span className="muted small">engagement {shoot[k]!.med}, n={shoot[k]!.n}{shoot[k]!.runnerUp ? ` · next best ${label(shoot[k]!.runnerUp!.k)} at ${shoot[k]!.runnerUp!.med}` : ""}</span></td></tr>
                  ))}
                  {occasions.length > 0 && <tr><td className="muted">Occasion</td><td><b>{[...new Set(occasions)].slice(0, 3).join(", ")}</b> <span className="muted small">named on your better reels</span></td></tr>}
                </tbody></table>
              )}
              <div className="cardhead" style={{ marginTop: 16 }}><b>Craft targets</b><span className="muted small">your last 10 vs the bar</span></div>
              <table className="lifts"><tbody>
                {gaps.map((g) => <tr key={g.d.key}><td>{g.d.label}</td><td className="num muted">{g.median}</td><td className="num">→ {g.bar}</td><td className={`num ${g.gap > 5 ? "down" : "up"}`}>{g.gap > 0 ? `${g.gap} short` : "at bar"}</td></tr>)}
              </tbody></table>
            </div>
          </section>

          <div className="card">
            <div className="cardhead"><b>The brief</b><span className="muted small">hand this to whoever shoots and edits</span></div>
            <ol className="brief">
              <li><b>Subject.</b> {shoot.motif ? `${label(shoot.motif.k)} motif` : "Best-performing motif once 6 reels are read"}{shoot.piece ? `, ${label(shoot.piece.k).toLowerCase()}` : ""}{shoot.colour ? `, ${label(shoot.colour.k).toLowerCase()}` : ""}{shoot.person ? `. ${shoot.person.k === "face_visible" ? "Face in frame; the piece worn, not held." : shoot.person.k === "hands_only" ? "Hands presenting the piece; no face." : "Piece alone on a plain surface."}` : ""}</li>
              <li><b>First second.</b> Jewellery already filling the frame and moving{mark("ttp") === "supported" ? " (proven)" : ""}.{mark("price") === "rejected" ? "" : ` Price as text on frame one${mark("price") === "supported" ? " (proven)" : ""}.`} Target time to product under {Math.max(0.5, +((100 - bar.hook) / 33).toFixed(1))}s.</li>
              <li><b>By second three.</b> {mark("telugu") === "rejected" ? "One line" : `One Telugu line${mark("telugu") === "supported" ? " (proven)" : ""}`} that gives a reason{mark("reason") === "supported" ? " (proven)" : ""}: occasion, price claim, or comparison.</li>
              <li><b>Look.</b> {issues.length ? issues.map(([i, v]) => `${i.replace(/_/g, " ")} keeps showing up (${v.n} of last 20)${v.fix ? `: ${v.fix}` : ""}`).join(". ") + "." : "Neutral white balance, one hard key light for sparkle, plain dark background."}</li>
              <li><b>Length and pace.</b> 7 to 15 seconds, an angle change every 2 to 3 seconds, product on screen for at least 80% of the reel.</li>
              <li><b>Caption.</b> One line, price, occasion, WhatsApp number, five hashtags.</li>
              {(proven.length > 0 || dropped.length > 0) && <li><b>From your tests.</b> {proven.length > 0 && <>Proven: {proven.map((h) => h.claim).join(" ")} </>}{dropped.length > 0 && <span className="muted">Dropped: {dropped.map((h) => h.variable).join(", ")}.</span>}</li>}
              <li><b>Beat this.</b> Overall {bar.overall} on the rubric{organic.length ? `, engagement above ${med(organic.map((x) => engById.get(x.r.id) ?? 0))}` : ""}.</li>
            </ol>
          </div>

          <section className="hero">
            <div className="card">
              <div className="cardhead"><b>What moves engagement</b><span className="muted small">{fit ? `from the regression, R² ${fit.r2}, n=${fit.n}` : `regression needs 12 organic reels, have ${organic.length}`}</span></div>
              {fit ? (
                <>
                  <table className="lifts"><tbody>{drivers.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num up">+{Math.round(d.coef)}</td></tr>)}</tbody></table>
                  {avoid.length > 0 && (<><div className="cardhead" style={{ marginTop: 12 }}><b>Pulls it down</b></div><table className="lifts"><tbody>{avoid.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num down">{Math.round(d.coef)}</td></tr>)}</tbody></table></>)}
                </>
              ) : <p className="muted">Until then the brief leans on the bar and on what sells.</p>}
            </div>
            <div className="card">
              <div className="cardhead"><b>Copy from these</b><span className="muted small">your top organic reels by engagement</span></div>
              {top.length === 0 ? <p className="muted">No organic reels with engagement yet.</p> : (
                <div className="refs">
                  {top.map(({ r, s }) => (
                    <Link key={r.id} href={`/reel/${r.id}`} className="ref">
                      {r.thumb && <img src={r.thumb} alt="" />}
                      <div><b>{engById.get(r.id)}</b> engagement · {s.overall} score<div className="muted small">{r.name}</div>{r.report?.subject && <div className="muted small">{label(r.report.subject.motif)} · {label(r.report.subject.piece)} · {label(r.report.subject.person)}</div>}{r.report?.subject?.emotional_hook && <div className="small">“{r.report.subject.emotional_hook}”</div>}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
