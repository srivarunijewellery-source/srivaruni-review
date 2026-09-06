"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Res = Record<string, unknown>;
const post = async (path: string): Promise<Res> => {
  const r = await fetch(path, { method: "POST" });
  try { return await r.json(); } catch { return { error: `HTTP ${r.status}` }; }
};

export default function Actions({ pending }: { pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "import" | "scan" | "analyze">("");
  const [msg, setMsg] = useState("");
  const stopRef = useRef(false);

  async function run(kind: "import" | "scan") {
    setBusy(kind); setMsg(kind === "import" ? "Fetching posted reels from Instagram…" : "Checking the Drive folder…");
    const r = await post(`/api/${kind}`);
    setMsg(r.error ? `Failed: ${r.error}` : r.skipped ? String(r.skipped) : `${r.added} new, ${r.pending} waiting for analysis${r.bounced ? `, ${r.bounced} bounced for size` : ""}`);
    setBusy(""); router.refresh();
  }

  // Start three server-side chains; each one keeps claiming the next reel on Vercel until nothing is pending.
  // The browser only watches progress, so opening a reel or closing the tab does not stop the run.
  const LANES = 3;
  async function analyze() {
    setBusy("analyze"); stopRef.current = false;
    await post("/api/pause?resume=1");
    const start = ((await (await fetch("/api/status")).json()) as Res).pending as number;
    for (let i = 0; i < LANES; i++) fetch("/api/analyze?chain=1", { method: "POST" }).catch(() => {});
    setMsg(`Analysing ${start} reels…`);
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const st = (await (await fetch("/api/status")).json()) as { pending: number; processing: number };
      const left = st.pending + st.processing;
      setMsg(`Analysing… ${Math.max(0, start - left)} of ${start} done`);
      router.refresh();
      if (left === 0) { setMsg(`Done. ${start} analysed.`); break; }
      if (stopRef.current) { await post("/api/pause"); setMsg(`Paused with ${st.pending} waiting. Press Analyze to resume.`); break; }
    }
    setBusy(""); router.refresh();
  }

  async function reanalyze() {
    if (!confirm("Re-score every analysed reel with the current rubric? Uses stored frames, about 10s per reel.")) return;
    setBusy("scan"); const r = await post("/api/reanalyze"); setMsg(r.error ? `Failed: ${r.error}` : `${r.queued} reels queued. Press Analyze.`); setBusy(""); router.refresh();
  }

  return (
    <div className="actions">
      <button className="link" disabled={!!busy} onClick={reanalyze} title="Re-score every reel with the current rubric, from stored frames">Re-score all</button>
      <button className="ghost" disabled={!!busy} onClick={() => run("import")}>{busy === "import" ? "Importing…" : "Import from Instagram"}</button>
      <button className="ghost" disabled={!!busy} onClick={() => run("scan")}>{busy === "scan" ? "Scanning…" : "Scan Drive"}</button>
      {busy === "analyze"
        ? <button onClick={() => { stopRef.current = true; }}>Pause</button>
        : <button disabled={!!busy || pending === 0} onClick={analyze}>Analyze {pending > 0 ? `(${pending})` : ""}</button>}
      {msg && <span className={`status${busy ? " live" : ""}`}>{msg}</span>}
    </div>
  );
}
