import { createClient } from "@supabase/supabase-js";

export type Reel = {
  id: string;
  drive_file_id: string;
  name: string;
  caption: string | null;
  status: "pending" | "processing" | "ready" | "fix" | "error";
  metrics: Metrics | null;
  report: Report | null;
  frames: { t: number; src: string }[] | null;
  transcript: string | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  insights: Record<string, number> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Metrics = {
  duration_s: number;
  fps_sampled: number;
  cuts: number;
  cuts_per_10s: number;
  sharpness: number; // 0-100, median over product frames
  sharpness_first_3s: number;
  brightness: number; // 0-255 mean
  width: number;
  height: number;
};

export type Check = { name: string; pass: boolean; value: string; target: string; fix: string };

export type Report = {
  verdict: "ready" | "fix";
  score: number;
  time_to_product_s: number | null;
  price_on_screen_s: number | null;
  telugu_text_s: number | null;
  reason_to_stay_s: number | null;
  product_frames: number[]; // indices of frames where jewellery fills the frame
  checks: Check[];
  hooks: string[];
  caption_rewrite: string;
  summary: string;
};

export const db = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
