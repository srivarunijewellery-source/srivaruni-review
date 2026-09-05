import { db, type Reel } from "@/lib/db";

export const dynamic = "force-dynamic";

function Spark({ xs, max }: { xs: number[]; max: number }) {
  if (xs.length < 2) return null;
  const w = 100, h = 26;
  const pts = xs.map((v, i) => `${(i / (xs.length - 1)) * w},${h - (Math.min(v, max) / max) * (h - 2) - 1}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--plum)" strokeWidth="1.5" /></svg>;
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export default async function Home() {
  const { data } = await db().from("reels").select("*").order("created_at", { ascending: false }).limit(200);
  const reels = (data ?? []) as Reel[];
  const scored = reels.filter((r) => r.report && r.metrics).slice(0, 20).reverse();
  const ttp = scored.map((r) => r.report!.time_to_product_s ?? 5);
  const sharp = scored.map((r) => r.metrics!.sharpness);
  const readyRate = scored.length ? Math.round((100 * scored.filter((r) => r.report!.verdict === "ready").length) / scored.length) : null;
  const saves = scored.map((r) => r.insights?.saved ?? 0);

  // What actually worked: for each check, median saves when it passed vs failed, over every posted reel with insights.
  const posted = reels.filter((r) => r.report && r.insights && typeof r.insights.saved === "number");
  const lifts = posted.length >= 6
    ? posted[0].report!.checks.map((c) => {
        const pass = posted.filter((r) => r.report!.checks.find((x) => x.name === c.name)?.pass).map((r) => r.insights!.saved);
        const fail = posted.filter((r) => !r.report!.checks.find((x) => x.name === c.name)?.pass).map((r) => r.insights!.saved);
        return { name: c.name, pass: med(pass), fail: med(fail), n: pass.length, m: fail.length };
      }).filter((l) => l.n >= 3 && l.m >= 3).sort((a, b) => ((b.pass ?? 0) - (b.fail ?? 0)) - ((a.pass ?? 0) - (a.fail ?? 0)))
    : [];

  return (
    <>
      <h1>Every reel, checked before it posts</h1>
      <p className="muted">Drafts go in the Drive folder “1. To review”. Posted reels come in from Instagram with their real saves. Same rubric for both, so the bar is one number.</p>

      {scored.length > 0 && (
        <div className="stats">
          <div className="stat"><b>{med(ttp)?.toFixed(1)}s</b><small>median time to product, last {scored.length}</small><Spark xs={ttp} max={5} /></div>
          <div className="stat"><b>{med(sharp)}</b><small>median sharpness /100</small><Spark xs={sharp} max={100} /></div>
          <div className="stat"><b>{readyRate}%</b><small>ready on first upload</small></div>
          {saves.some((s) => s > 0) && <div className="stat"><b>{saves.reduce((a, b) => a + b, 0)}</b><small>saves on posted reels</small><Spark xs={saves} max={Math.max(...saves, 1)} /></div>}
        </div>
      )}

      {lifts.length > 0 && (
        <div className="bar">
          <b>What earned saves on your {posted.length} posted reels</b>
          <p className="muted" style={{ margin: "4px 0 10px" }}>Median saves when a check passed vs failed. The biggest gaps are the rules that matter for Sri Varuni; tighten those first.</p>
          <table>
            <thead><tr><th>Check</th><th>Passed</th><th>Failed</th><th>Reels</th></tr></thead>
            <tbody>{lifts.map((l) => <tr key={l.name}><td>{l.name}</td><td>{l.pass}</td><td>{l.fail}</td><td>{l.n}/{l.m}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {reels.length === 0 ? (
        <div className="empty">Nothing here yet. Press “Import posted reels” to score what is already on Instagram, or drop a draft in “1. To review” on Drive.</div>
      ) : (
        <div className="list">
          {reels.map((r) => {
            const first = r.frames?.[r.report?.product_frames?.[0] ?? 0]?.src;
            const fails = r.report?.checks.filter((c) => !c.pass).map((c) => c.name).slice(0, 2).join(", ");
            return (
              <a className="row" key={r.id} href={`/reel/${r.id}`}>
                {first ? <img src={first} alt="" /> : <div className="thumb" />}
                <div>
                  <div className="name">{r.name}</div>
                  <div className="facts">
                    {r.report ? <>Product at {r.report.time_to_product_s === null ? "never" : `${r.report.time_to_product_s.toFixed(1)}s`} · sharpness {r.metrics?.sharpness} · {r.metrics?.duration_s}s{fails ? ` · fix: ${fails}` : ""}{r.insights?.saved !== undefined ? ` · ${r.insights.saved} saves` : ""}</> : r.error ? r.error.slice(0, 140) : r.status === "processing" ? "Analysing now" : "Waiting for the next scan"}
                  </div>
                </div>
                <div className="pillcol"><span className={`pill ${r.status}`}>{r.status === "ready" ? `Ready ${r.report?.score}` : r.status === "fix" ? `Fix ${r.report?.score}` : r.status}</span></div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
