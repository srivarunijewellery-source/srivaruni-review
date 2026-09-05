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

  // One reel per request, looping until the queue is empty or the user stops it.
  async function analyze() {
    setBusy("analyze"); stopRef.current = false; let n = 0, skipped = 0, failed = 0;
    for (let i = 0; i < 200; i++) {
      setMsg(`Analysing… ${n} done${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed` : ""}`);
      const r = await post("/api/analyze");
      if (r.error && !r.processed) { setMsg(`Stopped: ${r.error}`); break; }
      if (r.done) { setMsg(`Done. ${n} analysed${skipped ? `, ${skipped} skipped (no video from Instagram)` : ""}${failed ? `, ${failed} failed` : ""}.`); break; }
      if (r.skipped) skipped++; else if (r.error) failed++; else n++;
      router.refresh();
      if (failed >= 5) { setMsg(`Stopped after 5 failures. Last: ${r.error}`); break; }
      if (stopRef.current) { setMsg(`Paused. ${n} analysed.`); break; }
    }
    setBusy(""); router.refresh();
  }

  return (
    <div className="actions">
      <button className="ghost" disabled={!!busy} onClick={() => run("import")}>{busy === "import" ? "Importing…" : "Import from Instagram"}</button>
      <button className="ghost" disabled={!!busy} onClick={() => run("scan")}>{busy === "scan" ? "Scanning…" : "Scan Drive"}</button>
      {busy === "analyze"
        ? <button onClick={() => { stopRef.current = true; }}>Stop</button>
        : <button disabled={!!busy || pending === 0} onClick={analyze}>Analyze {pending > 0 ? `(${pending})` : ""}</button>}
      {msg && <span className={`status${busy ? " live" : ""}`}>{msg}</span>}
    </div>
  );
}
