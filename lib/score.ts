import type { Check, Metrics, Report, Subject, Richness } from "./db";
import type { Frame } from "./video";

const SHARPNESS_MIN = () => +(process.env.SHARPNESS_MIN ?? 55);

// The Sri Varuni reel spec. Hard numbers live here so editors get the same verdict every time.
export const RULES = {
  time_to_product_s: 1.0,
  price_on_screen_s: 1.0,
  telugu_text_s: 3.0,
  reason_to_stay_s: 3.0,
  duration_min_s: 7,
  duration_max_s: 15,
  cuts_per_10s_min: 4,
  brightness_min: 70,
  hashtags_max: 5,
};

const SYSTEM = `You review short jewellery reels for Sri Varuni Fashion Jewellery, a two-store fashion jewellery retailer in Boduppal (Hyderabad) and Zaheerabad, Telangana. Buyers are Telugu-speaking women 20 to 50 buying for weddings, festivals and functions. They decide to stop scrolling in under one second and decide to keep watching by second three.

You receive sampled frames (timestamps given), measured metrics, the caption, and sometimes a transcript. Judge only what is visible. Be specific and blunt, like a senior editor, in plain English. Never praise generically.

Definitions:
- "product on screen": the jewellery piece fills at least 40% of the frame, in focus, clearly the subject. A hand entering, a logo, a fade-in, or a wide shot of a person does not count.
- "price on screen": a rupee amount legible on the frame.
- "reason to stay": an on-screen line or spoken line that tells the viewer why this piece matters now: an occasion, a price claim, a comparison, a scarcity line.
- Telugu text: Telugu script visible on screen (transliterated Telugu in Latin letters also counts if clearly Telugu).
- richness: does the jewellery look expensive on screen? Premium = neutral white balance, metal with real depth and shine, stones that sparkle, clean background, controlled highlights. Cheap = yellow or green cast over the metal, flat even light with no shine, plastic-looking finish, dull stones, busy or cluttered background, blown highlights. Judge the product frames only. Be harsh: most phone footage of gold-tone jewellery reads yellow and flat.

Record your review with the report tool.`;

const REPORT_TOOL = {
  name: "report",
  description: "Record the reel review.",
  input_schema: {
    type: "object",
    properties: {
      time_to_product_s: { type: ["number", "null"], description: "Seconds until the jewellery fills the frame in focus; null if never" },
      price_on_screen_s: { type: ["number", "null"], description: "Seconds until a rupee price is legible; null if never" },
      telugu_text_s: { type: ["number", "null"], description: "Seconds until Telugu text appears on screen; null if never" },
      reason_to_stay_s: { type: ["number", "null"], description: "Seconds until an on-screen or spoken reason to keep watching; null if never" },
      product_frames: { type: "array", items: { type: "integer" }, description: "0-based indices of frames where the product is on screen" },
      opening: { type: "string", description: "What the first second actually shows, one sentence" },
      what_is_missing: { type: "array", items: { type: "string" }, description: "2 to 5 concrete visual observations" },
      hooks: { type: "array", items: { type: "string" }, description: "3 first-second on-screen lines, Telugu then English in brackets, max 8 words each" },
      caption_rewrite: { type: "string", description: "Caption in house format: one line, price, occasion, 'WhatsApp: [number]' placeholder, 5 hashtags max" },
      summary: { type: "string", description: "Two sentences an editor can act on" },
      richness: {
        type: "object",
        description: "Premium feel of the jewellery as shown, judged on product frames only.",
        properties: {
          score: { type: "integer", description: "0-100. 80+ only if it would pass for a brand catalogue shot." },
          look: { type: "string", enum: ["premium", "decent", "cheap"] },
          issues: { type: "array", items: { type: "string", enum: ["yellow_cast", "green_cast", "flat_light", "cluttered_background", "plastic_finish", "dull_stones", "overexposed", "low_contrast", "busy_frame"] } },
          fix: { type: ["string", "null"], description: "One concrete shooting or grading fix, e.g. 'set white balance to daylight and add a hard key from 45° for sparkle'" },
        },
        required: ["score", "look", "issues", "fix"],
      },
      subject: {
        type: "object",
        description: "What the reel shows. Subject matter drives engagement as much as craft.",
        properties: {
          motif: { type: "string", enum: ["deity_temple", "floral_nature", "bridal_heavy", "minimal_daily", "contemporary", "other"], description: "deity_temple = Lakshmi, Ganesha, temple work, kemp, nakshi; bridal_heavy = full bridal sets; minimal_daily = office/daily wear" },
          piece: { type: "string", enum: ["necklace_set", "choker", "long_haram", "earrings", "bangles", "maang_tikka", "mixed", "other"] },
          person: { type: "string", enum: ["none", "hands_only", "face_visible"] },
          colour: { type: "string", enum: ["gold", "silver", "coloured_stones", "pearls", "mixed"] },
          occasion: { type: ["string", "null"], description: "Occasion named on screen or in caption, e.g. Bathukamma, wedding, reception; null if none" },
          emotional_hook: { type: ["string", "null"], description: "The feeling the reel sells in under 6 words, e.g. 'blessing for the bride'; null if none" },
        },
        required: ["motif", "piece", "person", "colour", "occasion", "emotional_hook"],
      },
    },
    required: ["time_to_product_s", "price_on_screen_s", "telugu_text_s", "reason_to_stay_s", "product_frames", "opening", "what_is_missing", "hooks", "caption_rewrite", "summary", "subject", "richness"],
  },
};

export async function scoreWithClaude(input: {
  frames: Frame[];
  metrics: Metrics;
  caption: string | null;
  transcript: string | null;
}): Promise<Report> {
  const { frames, metrics, caption, transcript } = input;
  const content: unknown[] = [];
  frames.forEach((f, i) => {
    content.push({ type: "text", text: `frame ${i} @ ${f.t.toFixed(2)}s (sharpness ${f.sharp}/100)` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpg.toString("base64") } });
  });
  content.push({
    type: "text",
    text: `Measured: duration ${metrics.duration_s}s, ${metrics.cuts} cuts (${metrics.cuts_per_10s} per 10s), median brightness ${metrics.brightness}/255, ${metrics.width}x${metrics.height}.
Caption: ${caption ?? "(none)"}
Transcript: ${transcript ?? "(no audio transcription available)"}
Record the review.`,
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5",
      max_tokens: 2000,
      system: SYSTEM,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: "report" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Claude: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const call = (data.content as { type: string; name?: string; input?: Record<string, unknown> }[]).find((c) => c.type === "tool_use" && c.name === "report");
  if (!call?.input) throw new Error("Claude returned no report");
  const ai = call.input;

  return buildReport(ai, metrics, frames, caption);
}

function buildReport(ai: Record<string, unknown>, metrics: Metrics, frames: Frame[], caption: string | null): Report {
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const productIdx = Array.isArray(ai.product_frames) ? (ai.product_frames as number[]).filter((i) => frames[i]) : [];
  const productSharp = productIdx.length ? median(productIdx.map((i) => frames[i].sharp)) : metrics.sharpness;
  metrics.sharpness = productSharp;
  const pf = productIdx.length ? productIdx.map((i) => frames[i]) : frames;
  metrics.warmth = Math.round(median(pf.map((f) => f.colour.warmth)));
  metrics.saturation = Math.round(median(pf.map((f) => f.colour.sat)));
  metrics.contrast = Math.round(median(pf.map((f) => f.colour.contrast)));
  metrics.sparkle = +median(pf.map((f) => f.colour.sparkle)).toFixed(2);
  const rich = (ai.richness && typeof ai.richness === "object" ? ai.richness : { score: 50, look: "decent", issues: [], fix: null }) as Richness;
  const richPass = rich.score >= 60 && !rich.issues.includes("yellow_cast") && !rich.issues.includes("plastic_finish");

  const ttp = n(ai.time_to_product_s), price = n(ai.price_on_screen_s), te = n(ai.telugu_text_s), stay = n(ai.reason_to_stay_s);
  const hashtags = (caption?.match(/#\w+/g) ?? []).length;
  const hasCta = /whatsapp|dm|message|visit/i.test(caption ?? "");
  const s = (x: number | null) => (x === null ? "never" : `${x.toFixed(1)}s`);

  const checks: Check[] = [
    { name: "Time to product", pass: ttp !== null && ttp <= RULES.time_to_product_s, value: s(ttp), target: `≤ ${RULES.time_to_product_s}s`, fix: ttp === null ? "The jewellery never fills the frame. Re-shoot closer." : `Cut the first ${Math.max(0, ttp - 0.25).toFixed(1)}s. Open on the piece already moving.` },
    { name: "Price on screen", pass: price !== null && price <= RULES.price_on_screen_s, value: s(price), target: `by ${RULES.price_on_screen_s}s`, fix: "Put the ₹ price as text on the first frame." },
    { name: "Reason to stay", pass: stay !== null && stay <= RULES.reason_to_stay_s, value: s(stay), target: `by ${RULES.reason_to_stay_s}s`, fix: "Add one line by second 3: occasion, price claim, or comparison." },
    { name: "Telugu on screen", pass: te !== null && te <= RULES.telugu_text_s, value: s(te), target: `by ${RULES.telugu_text_s}s`, fix: "Add a Telugu line in the first 3 seconds." },
    { name: "Sharpness on product", pass: productSharp >= SHARPNESS_MIN(), value: `${productSharp}/100`, target: `≥ ${SHARPNESS_MIN()}`, fix: "Refocus, add light, or move closer. Soft product frames read as cheap." },
    { name: "Rich look", pass: richPass, value: `${rich.score}/100, ${rich.look}${rich.issues.length ? ` (${rich.issues.map((i) => i.replace(/_/g, " ")).join(", ")})` : ""}`, target: "≥ 60, no yellow cast", fix: rich.fix ?? "Neutral white balance, one hard light for sparkle, plain dark background." },
    { name: "Length", pass: metrics.duration_s >= RULES.duration_min_s && metrics.duration_s <= RULES.duration_max_s, value: `${metrics.duration_s}s`, target: `${RULES.duration_min_s} to ${RULES.duration_max_s}s`, fix: metrics.duration_s > RULES.duration_max_s ? "Trim to 15s. Keep only product-in-motion shots." : "Too short to land a reason to stay. Add one more angle." },
    { name: "Cut rate", pass: metrics.cuts_per_10s >= RULES.cuts_per_10s_min, value: `${metrics.cuts_per_10s} per 10s`, target: `≥ ${RULES.cuts_per_10s_min} per 10s`, fix: "Add angle changes every 2 to 3 seconds." },
    { name: "Brightness", pass: metrics.brightness >= RULES.brightness_min, value: `${metrics.brightness}/255`, target: `≥ ${RULES.brightness_min}`, fix: "Shoot in daylight or add a fill light." },
    { name: "Caption CTA", pass: hasCta, value: hasCta ? "present" : "missing", target: "WhatsApp number or visit line", fix: "End the caption with \"WhatsApp: <number>\"." },
    { name: "Hashtags", pass: hashtags <= RULES.hashtags_max, value: String(hashtags), target: `≤ ${RULES.hashtags_max}`, fix: "Keep 5: #SriVaruni #HyderabadJewellery #ZaheerabadJewellery #FashionJewellery #TeluguBride" },
  ];

  // Weighted: the first three checks decide whether anyone watches at all.
  const weights = [22, 13, 13, 7, 13, 12, 5, 7, 2, 4, 2];
  const score = Math.round(checks.reduce((acc, c, i) => acc + (c.pass ? weights[i] : 0), 0));
  const hardFail = !checks[0].pass || !checks[4].pass;

  return {
    verdict: hardFail || score < 70 ? "fix" : "ready",
    score,
    time_to_product_s: ttp,
    price_on_screen_s: price,
    telugu_text_s: te,
    reason_to_stay_s: stay,
    product_frames: productIdx,
    checks,
    hooks: Array.isArray(ai.hooks) ? (ai.hooks as string[]).slice(0, 3) : [],
    caption_rewrite: String(ai.caption_rewrite ?? ""),
    subject: (ai.subject && typeof ai.subject === "object" ? ai.subject : undefined) as Subject | undefined,
    richness: rich,
    summary: [ai.opening, ...(Array.isArray(ai.what_is_missing) ? (ai.what_is_missing as string[]) : []), ai.summary].filter(Boolean).join(" "),
  };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function reportMarkdown(name: string, r: Report, m: Metrics, url: string) {
  const lines = [
    `# ${name}`,
    ``,
    `Verdict: ${r.verdict === "ready" ? "READY TO POST" : "FIX AND RE-UPLOAD"}   Score ${r.score}/100`,
    ``,
    r.summary,
    ``,
    `## Checks`,
    ...r.checks.map((c) => `- [${c.pass ? "x" : " "}] ${c.name}: ${c.value} (target ${c.target})${c.pass ? "" : `  →  ${c.fix}`}`),
    ``,
    `## Hooks for the first second`,
    ...r.hooks.map((h) => `- ${h}`),
    ``,
    `## Caption`,
    r.caption_rewrite,
    ``,
    `Duration ${m.duration_s}s, ${m.cuts} cuts, sharpness ${m.sharpness}/100, brightness ${m.brightness}/255.`,
    `Dashboard: ${url}`,
  ];
  return lines.join("\n");
}
