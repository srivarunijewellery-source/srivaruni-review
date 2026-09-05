"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Res = Record<string, unknown>;
const post = async (path: string): Promise<Res> => {
  const r = await fetch(path, { method: "POST" });
  try { return await r.json(); } catch { return { error: `HTTP ${r.status}` }; }
};

export default function Actions() {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "scan" | "import">("");
  const [msg, setMsg] = useState("");

  async function scan() {
    setBusy("scan"); setMsg("Checking Drive…");
    const r = await post("/api/scan");
    setMsg(r.error ? `Scan failed: ${r.error}` : r.processed ? `${r.processed}: ${r.verdict === "ready" ? "ready" : "fix"}${r.score ? ` (${r.score})` : ""}` : `Inbox checked, ${r.registered ?? 0} new`);
    setBusy(""); router.refresh();
  }

  // Import runs one reel per request; keep calling until Meta says there is nothing left.
  async function importAll() {
    setBusy("import"); let n = 0;
    for (let i = 0; i < 60; i++) {
      setMsg(n ? `Imported ${n}, fetching next…` : "Fetching your posted reels…");
      const r = await post("/api/import");
      if (r.error) { setMsg(`Import stopped: ${r.error}`); break; }
      if (r.skipped) { setMsg(String(r.skipped)); break; }
      if (r.done) { setMsg(n ? `Done. ${n} reels scored.` : "Everything already imported."); break; }
      n++; setMsg(`Imported ${n}: ${String(r.processed).slice(0, 40)} · score ${r.score}${r.saves != null ? ` · ${r.saves} saves` : ""}`);
      router.refresh();
    }
    setBusy(""); router.refresh();
  }

  return (
    <div className="actions">
      <button className="ghost" disabled={!!busy} onClick={importAll}>{busy === "import" ? "Importing…" : "Import posted reels"}</button>
      <button disabled={!!busy} onClick={scan}>{busy === "scan" ? "Scanning…" : "Scan Drive now"}</button>
      {msg && <span className={`status${busy ? " live" : ""}`}>{msg}</span>}
    </div>
  );
}
