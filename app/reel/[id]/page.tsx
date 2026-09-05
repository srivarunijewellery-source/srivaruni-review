import { db, type Reel } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db().from("reels").select("*").eq("id", id).single();
  if (!data) notFound();
  const r = data as Reel;
  const rep = r.report, m = r.metrics;
  const product = new Set(rep?.product_frames ?? []);
  const firstProduct = rep?.product_frames?.[0];

  return (
    <>
      <a href="/" className="muted">← All reels</a>
      <h1>{r.name}</h1>
      {!rep && <p className="muted">{r.status === "error" ? `Analysis failed: ${r.error}` : "Not analysed yet. The next scan picks it up."}</p>}

      {rep && m && (
        <>
          <div className="verdict">
            <span className={`score ${rep.verdict}`}>{rep.score}</span>
            <span className={`pill ${rep.verdict}`}>{rep.verdict === "ready" ? "Ready to post" : "Fix and re-upload"}</span>
            <span className="muted">{m.duration_s}s · {m.width}×{m.height} · {m.cuts} cuts</span>
          </div>
          <p>{rep.summary}</p>

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
          {r.caption && <p className="muted">Yours: {r.caption}</p>}
          <div className="caption">{rep.caption_rewrite}</div>

          {r.transcript && (<><h2>Voiceover heard</h2><div className="transcript">{r.transcript}</div></>)}
        </>
      )}

      <h2>After posting</h2>
      <form className="linkform" action={`/api/reels/${r.id}/link`} method="post">
        <input type="url" name="permalink" defaultValue={r.ig_permalink ?? ""} placeholder="Paste the Instagram reel link" />
        <button type="submit">Save link</button>
      </form>
      {r.insights && Object.keys(r.insights).length > 0 && (
        <div className="kv" style={{ marginTop: 14 }}>
          {Object.entries(r.insights).map(([k, v]) => <div key={k}><b>{typeof v === "number" ? Math.round(v * 10) / 10 : String(v)}</b><span className="muted">{k.replace(/^ig_reels_/, "").replace(/_/g, " ")}</span></div>)}
        </div>
      )}
    </>
  );
}
