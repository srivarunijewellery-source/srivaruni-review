import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { laplacianVariance, sharpnessScore, meanBrightness, frameDiff, countCuts, median } from "./metrics.mjs";
import type { Metrics } from "./db";

const run = promisify(execFile);
const FPS = 4; // sample rate; 0.25s resolution on time-to-product
const MAX_S = 20; // ponytail: reels past 15s already fail the length check; 20s covers the verdict and keeps 1080p decode under the function limit

export type Frame = { t: number; jpg: Buffer; sharp: number; bright: number; colour: Colour };
export type Colour = { warmth: number; sat: number; contrast: number; sparkle: number };

export async function analyze(videoPath: string, workDir: string) {
  await mkdir(workDir, { recursive: true });
  const ff = ffmpegInstaller.path;

  // Duration + dimensions come from ffmpeg's own stderr banner; no ffprobe binary needed.
  let banner = "";
  try { await run(ff, ["-i", videoPath], { maxBuffer: 1 << 20 }); } catch (e) { banner = String((e as { stderr?: string }).stderr ?? ""); }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(banner);
  const duration_s = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const dim = /, (\d{2,5})x(\d{2,5})[,\s]/.exec(banner);
  const width = dim ? +dim[1] : 0, height = dim ? +dim[2] : 0;

  await run(ff, ["-y", "-t", String(MAX_S), "-i", videoPath, "-vf", `fps=${FPS},scale=360:-2`, "-q:v", "4", path.join(workDir, "f_%04d.jpg")], { maxBuffer: 1 << 24 });
  const audioPath = path.join(workDir, "audio.mp3");
  let hasAudio = true;
  try { await run(ff, ["-y", "-t", String(MAX_S), "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audioPath]); } catch { hasAudio = false; }

  const names = (await readdir(workDir)).filter((n) => n.startsWith("f_")).sort();
  const frames: Frame[] = [];
  const thumbs: Uint8Array[] = [];
  for (let i = 0; i < names.length; i++) {
    const jpg = await readFile(path.join(workDir, names[i]));
    const img = sharp(jpg).greyscale();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const thumb = await sharp(jpg).greyscale().resize(32, 56, { fit: "fill" }).raw().toBuffer();
    thumbs.push(new Uint8Array(thumb));
    const rgb = await sharp(jpg).resize(48, 85, { fit: "fill" }).removeAlpha().raw().toBuffer();
    frames.push({ t: i / FPS, jpg, sharp: sharpnessScore(laplacianVariance(data, info.width, info.height)), bright: meanBrightness(data), colour: colourStats(rgb, data) });
  }
  const diffs = thumbs.slice(1).map((t, i) => frameDiff(thumbs[i], t));
  const cuts = countCuts(diffs);
  const sampled = Math.min(duration_s, MAX_S) || frames.length / FPS;

  const metrics: Omit<Metrics, "sharpness"> & { sharpness: number } = {
    duration_s: +duration_s.toFixed(2),
    fps_sampled: FPS,
    cuts,
    cuts_per_10s: +((cuts / Math.max(sampled, 1)) * 10).toFixed(1),
    sharpness: median(frames.map((f) => f.sharp)), // overwritten with product-frame median after Claude marks them
    sharpness_first_3s: median(frames.filter((f) => f.t < 3).map((f) => f.sharp)),
    brightness: Math.round(median(frames.map((f) => f.bright))),
    width,
    height,
  };
  return { frames, metrics, audioPath: hasAudio ? audioPath : null };
}

/** Frames sent to Claude: every sample in the first 3s, then one per second. Keeps the call under ~25 images. */
export function pickForClaude(frames: Frame[]) {
  return frames.filter((f, i) => f.t < 3 || i % FPS === 0);
}

/** Frames kept for the dashboard and for re-scoring: same selection, shrunk to 240px, with their sharpness and colour read. */
export async function pickForStorage(frames: Frame[]) {
  const out: { t: number; src: string; sharp: number; colour: Colour }[] = [];
  for (const f of pickForClaude(frames)) {
    const small = await sharp(f.jpg).resize(240).jpeg({ quality: 70 }).toBuffer();
    out.push({ t: f.t, src: `data:image/jpeg;base64,${small.toString("base64")}`, sharp: f.sharp, colour: f.colour });
  }
  return out;
}

/** Rebuild Claude-ready frames from what is stored, so a rubric change never touches the video again. */
export async function framesFromStored(stored: { t: number; src: string; sharp?: number; colour?: Colour }[], fallbackSharp: number): Promise<Frame[]> {
  const out: Frame[] = [];
  for (const f of stored) {
    const jpg = Buffer.from(f.src.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    let colour = f.colour;
    if (!colour) {
      const grey = await sharp(jpg).greyscale().raw().toBuffer();
      const rgb = await sharp(jpg).resize(48, 85, { fit: "fill" }).removeAlpha().raw().toBuffer();
      colour = colourStats(rgb, grey);
    }
    out.push({ t: f.t, jpg, sharp: f.sharp ?? fallbackSharp, bright: 0, colour });
  }
  return out;
}

export async function transcribe(audioPath: string | null): Promise<string | null> {
  if (!audioPath || !process.env.GROQ_API_KEY) return null;
  const form = new FormData();
  form.append("file", new Blob([await readFile(audioPath)], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) return null;
  const j = await res.json();
  const segs = (j.segments ?? []) as { start: number; text: string }[];
  return segs.length ? segs.map((s) => `[${s.start.toFixed(1)}s] ${s.text.trim()}`).join("\n") : j.text ?? null;
}

export const cleanup = (dir: string) => rm(dir, { recursive: true, force: true });

/** Colour read of a frame: yellow cast, saturation, contrast, specular sparkle. Richness is judged on the product frames only. */
export function colourStats(rgb: Buffer, grey: Buffer): Colour {
  let r = 0, g = 0, b = 0, sat = 0, n = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const R = rgb[i], G = rgb[i + 1], B = rgb[i + 2];
    r += R; g += G; b += B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx ? (mx - mn) / mx : 0;
  }
  r /= n; g /= n; b /= n;
  // warmth: how far the average colour sits toward yellow (R+G high, B low). 0 neutral, ~40+ is a visible yellow cast.
  const warmth = Math.round(Math.max(0, (r + g) / 2 - b));
  let mean = 0; for (let i = 0; i < grey.length; i++) mean += grey[i]; mean /= grey.length;
  let v = 0, hi = 0; for (let i = 0; i < grey.length; i++) { v += (grey[i] - mean) ** 2; if (grey[i] > 245) hi++; }
  return { warmth, sat: Math.round((sat / n) * 100), contrast: Math.round(Math.sqrt(v / grey.length)), sparkle: +((100 * hi) / grey.length).toFixed(2) };
}
