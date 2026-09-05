import { db, type Reel } from "@/lib/db";
import { notFound } from "next/navigation";
import { DIMS, scoreDims, computeBar, tagFor, TAG_LABEL, rates } from "@/lib/dimensions";
import Radar from "../../radar";

export const dynamic = "force-dynamic";

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = db();
  const [{ data }, { data: all }] = await Promise.all([sb.from("reels").select("*").eq("id", id).single(), sb.from("reels").select("*").limit(300)]);
  if (!data) notFound();
  const r = data as Reel;
  const rep = r.report, m = r.metrics;
  const { bar, mid, n: barN } = computeBar((all ?? []) as Reel[]);
  const s = rep && m ? scoreDims(rep, m, r.caption) : null;
  const tag = s ? tagFor(s, bar, mid) : null;
  const e = rates(r.insights, m?.duration_s);
  const product = new Set(rep?.product_frames ?? []);
  const firstProduct = rep?.product_frames?.[0];

  return (
    <>
      <a href="/" className="muted small">← All reels</a>
      <h1>{r.name}</h1>
      {!rep && <p className="muted">{r.error ?? (r.status === "processing" ? "Analysing now." : "Waiting for Analyze.")}</p>}

      {rep && m && s && tag && (
        <>
          <section className="hero">
            <div className="card radarcard">
              <div className="verdict">
                <span className={`score ${tag}`}>{s.overall}</span>
                <div>
                  <div className={`tag ${tag}`}>{TAG_LABEL[tag]}</div>
                  <div className="muted small">bar {bar.overall} · p75 of {barN} reels</div>
                </div>
              </div>
              <Radar scores={s} bar={bar} size={320} />
            </div>
            <div className="card">
              <div className="cardhead"><b>Dimensions</b><span className="muted small">this reel vs bar</span></div>
              <table className="dims">
                <tbody>
                  {DIMS.map((d) => {
                    const delta = s[d.key] - bar[d.key];
                    return (
                      <tr key={d.key}>
                        <td><b>{d.label}</b><div className="muted small">{d.help}</div></td>
                        <td className="num">{s[d.key]}</td>
                        <td className={`num ${delta >= 0 ? "up" : "down"}`}>{delta >= 0 ? "+" : ""}{delta}</td>
                        <td className="barcell"><div className="track"><div className="fill" style={{ width: `${s[d.key]}%` }} /><div className="dot" style={{ left: `${bar[d.key]}%` }} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {e && (
                <>
                  <div className="cardhead" style={{ marginTop: 16 }}><b>Engagement</b><span className="muted small">{e.boosted ? "boosted, rates only" : "organic"} · {e.views.toLocaleString()} views</span></div>
                  <div className="kv">
                    <div><b>{e.saveRate}</b><span className="muted">saves / 1k views</span></div>
                    <div><b>{e.shareRate}</b><span className="muted">shares / 1k views</span></div>
                    <div><b>{e.likeRate}%</b><span className="muted">likes / views</span></div>
                    <div><b>{e.commentRate}</b><span className="muted">comments / 1k views</span></div>
                    {e.watchS != null && <div><b>{e.watchS}s</b><span className="muted">avg watch time</span></div>}
                    {e.watchThrough != null && <div><b>{e.watchThrough}%</b><span className="muted">watched through</span></div>}
                  </div>
                </>
              )}
            </div>
          </section>

          <div className="card">
            <div className="cardhead"><b>Editor notes</b></div>
            <p>{rep.summary}</p>
          </div>

          <h2>What the viewer sees</h2>
          <div className="legend"><i style={{ background: "var(--plum)" }} />first frame <i style={{ background: "var(--gold)" }} />jewellery on screen</div>
          <div className="film">
            {r.frames?.map((f, i) => (
              <figure key={i} className={`${product.has(i) ? "product" : ""} ${i === 0 ? "first" : ""}`}>
                <img src={f.src} alt={`frame at ${f.t}s`} loading="lazy" />
                <figcaption>{f.t.toFixed(2)}s{i === firstProduct ? " · product" : ""}</figcaption>
              </figure>
            ))}
          </div>

          <h2>Checks</h2>
          <div className="checks">
            {rep.checks.map((c) => (
              <div key={c.name} className={`check ${c.pass ? "pass" : "fail"}`}>
                <span className="mark">{c.pass ? "✓" : "✕"}</span>
                <div>
                  <div><b>{c.name}</b> <span className="val">{c.value} · target {c.target}</span></div>
                  {!c.pass && <div className="fixline">{c.fix}</div>}
                </div>
              </div>
            ))}
          </div>

          {rep.hooks.length > 0 && (<><h2>Hooks for the first second</h2><ul className="hooks">{rep.hooks.map((h, i) => <li key={i}>{h}</li>)}</ul></>)}

          <h2>Caption</h2>
          {r.caption && <p className="muted small">Yours: {r.caption}</p>}
          <div className="caption">{rep.caption_rewrite}</div>

          {r.transcript && (<><h2>Voiceover heard</h2><div className="transcript">{r.transcript}</div></>)}
        </>
      )}

      {!r.drive_file_id.startsWith("ig:") && (
        <>
          <h2>After posting</h2>
          <form className="linkform" action={`/api/reels/${r.id}/link`} method="post">
            <input type="url" name="permalink" defaultValue={r.ig_permalink ?? ""} placeholder="Paste the Instagram reel link" />
            <button type="submit">Save link</button>
          </form>
        </>
      )}
    </>
  );
}
