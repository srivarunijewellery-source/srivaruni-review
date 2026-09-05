import { db, type Reel } from "@/lib/db";
import { DIMS, scoreDims, computeBar, tagFor, TAG_LABEL, rates } from "@/lib/dimensions";
import Radar from "./radar";

export const dynamic = "force-dynamic";

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "all" } = await searchParams;
  const { data } = await db().from("reels").select("*").order("created_at", { ascending: false }).limit(300);
  const reels = (data ?? []) as Reel[];
  const { bar, mid, n: barN, source } = computeBar(reels);
  const scored = reels.filter((r) => r.report && r.metrics).map((r) => ({ r, s: scoreDims(r.report!, r.metrics!, r.caption), e: rates(r.insights, r.metrics!.duration_s) }));
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

  const shown = withTag.filter((x) => view === "all" || (view === "instagram" ? x.r.drive_file_id.startsWith("ig:") : !x.r.drive_file_id.startsWith("ig:")));
  const queue = reels.filter((r) => !r.report && (view === "all" || (view === "instagram") === r.drive_file_id.startsWith("ig:")));

  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Reels analysed</small><b>{withTag.length}</b><span>{pendingN} waiting</span></div>
        <div className="kpi"><small>Your bar</small><b>{bar.overall}</b><span>p75 of {barN} {source === "instagram" ? "posted reels" : "reels"}</span></div>
        <div className="kpi"><small>Raising the bar</small><b>{raising}%</b><span>of analysed reels</span></div>
        <div className="kpi"><small>Save rate</small><b>{med(saveRates)}</b><span>saves per 1k views, organic median</span></div>
      </div>

      <section className="hero">
        <div className="card radarcard">
          <div className="cardhead"><b>Latest vs your bar</b><span className="legend"><i style={{ background: "var(--gold)" }} />latest <i style={{ border: "1px dashed var(--plum)" }} />bar (p75)</span></div>
          {latest ? <Radar scores={latest.s} bar={bar} size={320} /> : <div className="empty small">Analyse a reel to see the radar.</div>}
          {latest && <div className="muted small">{latest.r.name}</div>}
        </div>
        <div className="card">
          <div className="cardhead"><b>The bar, by dimension</b><span className="muted small">p75 of your posted reels</span></div>
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
        </div>
      </section>

      <div className="tabs">
        {[["all", "All"], ["instagram", "Posted on Instagram"], ["drafts", "Drive drafts"]].map(([k, l]) => <a key={k} href={`/?view=${k}`} className={view === k ? "on" : ""}>{l}</a>)}
      </div>

      {shown.length === 0 && queue.length === 0 ? (
        <div className="empty">Nothing here yet. Import from Instagram, then press Analyze.</div>
      ) : (
        <div className="grid">
          {shown.map(({ r, s, tag, e }) => {
            const thumb = r.frames?.[r.report?.product_frames?.[0] ?? 0]?.src;
            return (
              <a className="tile" key={r.id} href={`/reel/${r.id}`}>
                <div className="tilehead">
                  {thumb ? <img src={thumb} alt="" /> : <div className="thumb" />}
                  <div className="mini"><Radar scores={s} bar={bar} size={120} labels={false} /></div>
                </div>
                <div className="tilebody">
                  <div className="tiletitle">{r.name}</div>
                  <div className="tagrow"><div className={`tag ${tag}`}>{TAG_LABEL[tag]}</div>{e?.boosted && <div className="tag boosted">Boosted</div>}</div>
                  <div className="tilefacts"><span><b>{s.overall}</b> score</span>{e && <span><b>{e.saveRate}</b> saves/1k</span>}{e?.watchThrough != null && <span><b>{e.watchThrough}%</b> watched</span>}</div>
                </div>
              </a>
            );
          })}
          {queue.map((r) => (
            <a className="tile queued" key={r.id} href={`/reel/${r.id}`}>
              <div className="tilebody">
                <div className="tiletitle">{r.name}</div>
                <div className={`tag ${r.status}`}>{r.status === "pending" ? "Waiting for Analyze" : r.status === "processing" ? "Analysing" : r.status === "error" ? "Skipped" : "Fix"}</div>
                {r.error && <div className="muted small">{r.error.slice(0, 120)}</div>}
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
