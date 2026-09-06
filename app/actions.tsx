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

  // Three reels at a time; each request claims its own reel server-side so nothing is processed twice.
  const LANES = 3;
  async function analyze() {
    setBusy("analyze"); stopRef.current = false; let n = 0, skipped = 0, failed = 0, done = false;
    const lane = async () => {
      while (!done && !stopRef.current && failed < 5) {
        const r = await post("/api/analyze");
        if (r.error && !r.processed) { setMsg(`Stopped: ${r.error}`); done = true; return; }
        if (r.done) { done = true; return; }
        if (r.skipped) skipped++; else if (r.error) failed++; else n++;
        setMsg(`Analysing… ${n} done${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed` : ""}`);
        router.refresh();
      }
    };
    setMsg("Analysing…");
    await Promise.all(Array.from({ length: LANES }, lane));
    setMsg(stopRef.current ? `Paused. ${n} analysed.` : failed >= 5 ? `Stopped after 5 failures.` : `Done. ${n} analysed${skipped ? `, ${skipped} skipped (no video from Instagram)` : ""}${failed ? `, ${failed} failed` : ""}.`);
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
        ? <button onClick={() => { stopRef.current = true; }}>Stop</button>
        : <button disabled={!!busy || pending === 0} onClick={analyze}>Analyze {pending > 0 ? `(${pending})` : ""}</button>}
      {msg && <span className={`status${busy ? " live" : ""}`}>{msg}</span>}
    </div>
  );
}
