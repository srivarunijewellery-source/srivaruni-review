import path from "node:path";
import { analyze, pickForClaude, pickForStorage, transcribe, framesFromStored } from "./video";
import { scoreWithClaude } from "./score";
import type { Reel } from "./db";

/** Shared by Drive drafts and imported Instagram posts: same metrics, same rubric, so scores are comparable. */
export async function analyzeAndScore(videoPath: string, work: string, caption: string | null) {
  const { frames, metrics, audioPath } = await analyze(videoPath, path.join(work, "frames"));
  const [transcript, stored] = await Promise.all([transcribe(audioPath), pickForStorage(frames)]);
  const report = await scoreWithClaude({ frames: pickForClaude(frames), metrics, caption, transcript });
  metrics.frame_count = stored.length;
  const thumb = stored[report.product_frames?.[0] ?? 0]?.src ?? null;
  const patch: Partial<Reel> = { status: report.verdict, metrics, report, frames: stored, thumb, transcript, error: null, updated_at: new Date().toISOString() };
  return { patch, report, metrics };
}

/** Re-score from stored frames and metrics: no download, no ffmpeg. ~10s instead of ~40s. */
export async function rescoreFromStored(reel: Reel) {
  const frames = await framesFromStored(reel.frames!, reel.metrics!.sharpness);
  const metrics = { ...reel.metrics! };
  const report = await scoreWithClaude({ frames, metrics, caption: reel.caption, transcript: reel.transcript });
  metrics.frame_count = reel.frames!.length;
  const thumb = reel.frames![report.product_frames?.[0] ?? 0]?.src ?? null;
  const patch: Partial<Reel> = { status: report.verdict, metrics, report, thumb, error: null, updated_at: new Date().toISOString() };
  return { patch, report, metrics };
}
