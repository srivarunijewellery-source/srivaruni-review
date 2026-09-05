import path from "node:path";
import { analyze, pickForClaude, pickForStorage, transcribe } from "./video";
import { scoreWithClaude } from "./score";
import type { Reel } from "./db";

/** Shared by Drive drafts and imported Instagram posts: same metrics, same rubric, so scores are comparable. */
export async function analyzeAndScore(videoPath: string, work: string, caption: string | null) {
  const { frames, metrics, audioPath } = await analyze(videoPath, path.join(work, "frames"));
  const [transcript, stored] = await Promise.all([transcribe(audioPath), pickForStorage(frames)]);
  const report = await scoreWithClaude({ frames: pickForClaude(frames), metrics, caption, transcript });
  const patch: Partial<Reel> = { status: report.verdict, metrics, report, frames: stored, transcript, error: null, updated_at: new Date().toISOString() };
  return { patch, report, metrics };
}
