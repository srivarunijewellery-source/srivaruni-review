import Link from "next/link";
import { db, LIST_COLS, type Reel } from "@/lib/db";
import { DIMS, scoreDims, computeBar, label, type Scores } from "@/lib/dimensions";
import Radar from "../radar";

export const dynamic = "force-dynamic";
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : 0; };

/** Competitor engagement proxy: likes + comments per 1k followers. Saves and views are private to the account. */
const proxy = (r: Reel) => { const i = r.insights ?? {}; const f = i.followers || 1; return Math.round((((i.likes ?? 0) + (i.comments ?? 0)) / f) * 1000 * 10) / 10; };

export default async function Competitors({ searchParams }: { searchParams: Promise<{ err?: string; added?: string; h?: string; info?: string }> }) {
  const { err, added, h, info } = await searchParams;
  const sb = db();
  const [{ data: mine, error }, { data: theirs }] = await Promise.all([
    sb.from("reels").select(LIST_COLS).is("competitor", null).order("created_at", { ascending: false }).limit(300),
    sb.from("reels").select(LIST_COLS).not("competitor", "is", null).order("created_at", { ascending: false }).limit(400),
  ]);
  const ours = (mine ?? []) as Reel[], comp = (theirs ?? []) as Reel[];
  if (error) return <div className="empty" style={{ color: "var(--fix)" }}>Database query failed: {error.message}. Run the pending SQL in supabase/schema.sql and reload.</div>;
  const { bar } = computeBar(ours);
  const score = (r: Reel) => scoreDims(r.report!, r.metrics!, r.caption);
  const oursScored = ours.filter((r) => r.report && r.metrics).map((r) => ({ r, s: score(r) }));
  const handles = [...new Set(comp.map((r) => r.competitor!))];
  const byHandle = handles.map((hd) => {
    const rs = comp.filter((r) => r.competitor === hd);
    const scored = rs.filter((r) => r.report && r.metrics).map((r) => ({ r, s: score(r), e: proxy(r) }));
    const followers = rs[0]?.insights?.followers ?? 0;
    const medS = Object.fromEntries([...DIMS.map((d) => [d.key, med(scored.map((x) => x.s[d.key]))]), ["overall", med(scored.map((x) => x.s.overall))]]) as Scores;
    const top = [...scored].sort((a, b) => b.e - a.e).slice(0, Math.max(1, Math.ceil(scored.length * 0.2)));
    return { hd, followers, total: rs.length, scored, medS, top, pending: rs.filter((r) => r.status === "pending").length };
  });

  // The implant list: what their top-20% reels do that your median does not, per dimension and per subject.
  const allTop = byHandle.flatMap((x) => x.top);
  const oursMed = Object.fromEntries(DIMS.map((d) => [d.key, med(oursScored.map((x) => x.s[d.key]))])) as Record<string, number>;
  const dimGaps = DIMS.map((d) => ({ d, theirs: med(allTop.map((x) => x.s[d.key])), ours: oursMed[d.key] ?? 0 })).map((g) => ({ ...g, gap: g.theirs - g.ours })).filter((g) => g.gap >= 8).sort((a, b) => b.gap - a.gap);
  const share = (rows: { r: Reel }[], key: "motif" | "piece" | "person" | "colour") => { const m = new Map<string, number>(); for (const x of rows) { const k = x.r.report?.subject?.[key]; if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].map(([k, n]) => ({ k, share: Math.round((100 * n) / Math.max(1, rows.length)) })).sort((a, b) => b.share - a.share); };
  const subjGaps = (["motif", "piece", "person", "colour"] as const).flatMap((key) => { const t = share(allTop, key), o = share(oursScored, key); return t.map((x) => ({ key, k: x.k, theirs: x.share, ours: o.find((y) => y.k === x.k)?.share ?? 0 })).filter((x) => x.theirs - x.ours >= 15); }).sort((a, b) => (b.theirs - b.ours) - (a.theirs - a.ours));
  const topProxy = pct(allTop.map((x) => x.e), 0.5);

  return (
    <>
      <h1>Competitors</h1>
      <p className="muted">Their public reels through your rubric. Engagement here is likes and comments per 1k followers, since saves and views are private to each account. What their top 20% does that you do not becomes a hypothesis, not a rule.</p>
      {err === "meta" && <p style={{ color: "var(--fix)" }}>Meta token and IG_USER_ID are needed for Business Discovery.</p>}
      {err && err !== "meta" && <p style={{ color: "var(--fix)" }}>{decodeURIComponent(err)}</p>}
      {added && <p className="muted small">Registered {added} reels from @{h}.{info ? ` Meta returned ${decodeURIComponent(info)}.` : ""}{+added > 0 ? " Press Analyze in the header to score them." : " Videos without a file are reels Meta withholds (usually copyrighted audio); images and carousels are not reels."}</p>}

      <form className="expform" action="/api/competitors" method="post" style={{ marginBottom: 18 }}>
        <label>Instagram handle<input type="text" name="handle" placeholder="@competitor_store" required /></label>
        <button type="submit">Add or refresh</button>
      </form>

      {handles.length === 0 ? <div className="empty">Add three or four competitor handles. They must be Business or Creator accounts, which almost every store is.</div> : (
        <>
          <div className="kpis">
            {byHandle.map((x) => (
              <div className="kpi" key={x.hd}><small>@{x.hd}</small><b>{x.scored.length ? x.medS.overall : "–"}</b><span>rubric median · {x.followers.toLocaleString("en-IN")} followers · {x.scored.length}/{x.total} scored{x.pending ? ` · ${x.pending} waiting` : ""}</span></div>
            ))}
            <div className="kpi"><small>Your bar</small><b>{bar.overall}</b><span>p75 of your posted reels</span></div>
          </div>

          <section className="hero">
            <div className="card radarcard">
              <div className="cardhead"><b>Their top 20% vs your bar</b><span className="legend"><i style={{ background: "var(--gold)" }} />their top <i style={{ border: "1px dashed var(--plum)" }} />your bar</span></div>
              {allTop.length ? <Radar scores={Object.fromEntries([...DIMS.map((d) => [d.key, med(allTop.map((x) => x.s[d.key]))]), ["overall", med(allTop.map((x) => x.s.overall))]]) as Scores} bar={bar} size={300} /> : <div className="empty small">Analyse their reels first.</div>}
            </div>
            <div className="card">
              <div className="cardhead"><b>Implant list</b><span className="muted small">what their best reels do that yours do not</span></div>
              {dimGaps.length === 0 && subjGaps.length === 0 ? <p className="muted">Nothing they do clearly better yet, or not enough scored. Analyse more of their reels.</p> : (
                <ul className="brief">
                  {dimGaps.map((g) => <li key={g.d.key}><b>{g.d.label}.</b> Their top reels sit at {g.theirs}, your median is {g.ours}. {g.d.help}. Candidate for the lab.</li>)}
                  {subjGaps.map((g) => <li key={g.key + g.k}><b>{label(g.k)}</b> ({g.key}). {g.theirs}% of their top reels, {g.ours}% of yours.</li>)}
                </ul>
              )}
              <p className="muted small" style={{ marginTop: 8 }}>Their top reels average {topProxy} likes and comments per 1k followers. Anything above that in their library is worth watching frame by frame.</p>
            </div>
          </section>

          {byHandle.map((x) => (
            <details className="card" key={x.hd} open={x.scored.length > 0}>
              <summary><b>@{x.hd}</b><span className="muted small">{x.scored.length} scored · top reels by engagement proxy</span></summary>
              <div className="grid">
                {[...x.scored].sort((a, b) => b.e - a.e).slice(0, 8).map(({ r, s, e }) => (
                  <Link className="tile" key={r.id} href={`/reel/${r.id}`}>
                    <div className="tilehead">{r.thumb ? <img src={r.thumb} alt="" /> : <div className="thumb" />}<div className="mini"><Radar scores={s} bar={bar} size={120} labels={false} /></div></div>
                    <div className="tilebody">
                      <div className="tiletitle">{r.name.replace(`@${x.hd} `, "")}</div>
                      <div className="tagrow">{r.report?.subject && <div className="tag subject">{label(r.report.subject.motif)}</div>}{r.report?.subject && <div className="tag subject">{label(r.report.subject.person)}</div>}</div>
                      <div className="tilefacts"><span><b>{s.overall}</b> score</span><span><b>{e}</b> eng/1k followers</span><span><b>{r.insights?.likes ?? 0}</b> likes</span></div>
                    </div>
                  </Link>
                ))}
              </div>
              {x.pending > 0 && <p className="muted small" style={{ marginTop: 10 }}>{x.pending} reels waiting; press Analyze.</p>}
            </details>
          ))}
        </>
      )}
    </>
  );
}
