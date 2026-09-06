import { createClient } from "@supabase/supabase-js";

export type Reel = {
  id: string;
  drive_file_id: string;
  name: string;
  caption: string | null;
  status: "pending" | "processing" | "paused" | "ready" | "fix" | "error";
  metrics: Metrics | null;
  report: Report | null;
  frames?: StoredFrame[] | null; // only loaded on the single-reel page
  thumb?: string | null;
  transcript: string | null;
  ig_media_id: string | null;
  ig_permalink: string | null;
  insights: Record<string, number> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredFrame = { t: number; src: string; sharp?: number; colour?: { warmth: number; sat: number; contrast: number; sparkle: number } };

export type Metrics = {
  duration_s: number;
  fps_sampled: number;
  cuts: number;
  cuts_per_10s: number;
  sharpness: number; // 0-100, median over product frames
  sharpness_first_3s: number;
  brightness: number; // 0-255 mean
  warmth?: number; // yellow cast on product frames, 0 neutral
  saturation?: number;
  contrast?: number;
  sparkle?: number; // % specular highlight pixels on product frames
  width: number;
  height: number;
  frame_count?: number;
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
  subject?: Subject;
  richness?: Richness;
};

export type Richness = {
  score: number; // 0-100 premium feel as judged from the frames
  look: "premium" | "decent" | "cheap";
  issues: string[]; // yellow_cast, flat_light, cluttered_background, plastic_finish, dull_stones, overexposed, low_contrast, busy_frame
  fix: string | null;
};

export type Subject = {
  motif: "deity_temple" | "floral_nature" | "bridal_heavy" | "minimal_daily" | "contemporary" | "other";
  piece: "necklace_set" | "choker" | "long_haram" | "earrings" | "bangles" | "maang_tikka" | "mixed" | "other";
  person: "none" | "hands_only" | "face_visible";
  colour: "gold" | "silver" | "coloured_stones" | "pearls" | "mixed";
  occasion: string | null;
  emotional_hook: string | null;
};

export const db = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

/** Columns for list pages: everything except the frames blob. */
export const LIST_COLS = "id,drive_file_id,name,caption,status,metrics,report,transcript,ig_media_id,ig_permalink,insights,error,created_at,updated_at,thumb";
