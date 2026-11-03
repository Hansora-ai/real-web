// What each generation cost Hansora at the provider, in USD.
//
// Prices come from the owner's margin sheet (25 Oct 2026), with the reAPI changes since then:
// Seedance 2.5 (10 s, no video) $1.19 / $2.67 / $6.43 and Wan 3.0 (10 s) $0.29 / $0.58 / $1.16 at
// 480p / 720p / 1080p. When a run recorded its settings (resolution, length, input video) the cost is
// computed from them. Otherwise it is the credits the user was charged times that model's provider cost
// per credit from the same sheet, which gives the exact cost whenever the model has one price ratio.
// Failed runs cost nothing (providers do not bill them).

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const DONE = new Set(["done", "ready", "completed", "success", "succeeded"]);

// Provider USD per displayed Hansora credit, matched against "kind provider model" (lower case), first match wins.
// Grok videos are recorded as "grok-imagine/image-to-video", so the image rules also check the kind.
export const COST_PER_CREDIT = [
  [/avatar_iii|avatar-iii/, 0.0495, "HeyGen Avatar III"],
  [/heygen|avatar_v|avatar-iv/, 0.0055, "HeyGen Avatar IV"],
  [/isolation|voice.?change/, 0.012, "ElevenLabs voice tools"],
  [/caption|scribe/, 0.0014, "ElevenLabs captions"],
  [/dialogue|text to speech|tts|elevenlabs|voice/, 0.008, "ElevenLabs speech"],
  [/suno|music/, 0.004, "Suno"],
  [/henshin lite/, 0.0075, "Henshin Lite"],
  [/henshin/, 0.0084, "Henshin"],
  [/seedance.?2\.?0.?mini|seedance 2\.0 mini/, 0.0032, "Seedance 2.0 Mini"],
  [/kid cartoon/, 0.0088, "Kid Cartoon"],
  [/seedance.?2\.5|seedance-2\.5|doubao-seedance-2\.5/, 0.0074, "Seedance 2.5"],
  [/seedance/, 0.0084, "Seedance 2.0"],
  [/wan.?3|wan3/, 0.0058, "Wan 3.0"],
  [/wan.?2\.?7.*image|wan-2-7-image/, 0.0048, "Wan 2.7 Image"],
  [/wan.?2\.?7|wan27/, 0.0057, "Wan 2.7 Video"],
  [/kling.?4|kling40|kling4/, 0.0075, "Kling 4.0"],
  [/motion.?control/, 0.0077, "Kling Motion Control"],
  [/kling.?3.?turbo|kling3-turbo|v3-turbo/, 0.0075, "Kling 3 Turbo"],
  [/kling.?3|kling30/, 0.0073, "Kling 3.0"],
  [/kling.?2\.?6|kling26/, 0.0071, "Kling 2.6"],
  [/kling/, 0.007, "Kling 2.5"],
  [/happyhorse/, 0.0078, "HappyHorse"],
  [/veo3_fast|veo3\.1fast|veo31-fast/, 0.0063, "Veo 3.1 Fast"],
  [/veo3_lite|veo3\.1lite|veo31-lite|veo.*lite/, 0.0072, "Veo 3.1 Lite"],
  [/veo/, 0.0075, "Veo 3.1 Quality"],
  [/gemini.?omni.?(1\.1)?.?flash|omni-flash/, 0.0076, "Gemini Omni Flash"],
  [/gemini.?omni|background change|video relight|video edit/, 0.0072, "Gemini Omni"],
  [/^image .*grok/, 0.0045, "Grok Image"],
  [/grok/, 0.0075, "Grok Video"],
  [/nano.?banana.?pro|nano-banana-pro/, 0.0076, "Nano Banana Pro"],
  [/nano.?banana.?2.?1|nano-banana-2-1/, 0.0063, "Nano Banana 2.1"],
  [/nano.?banana.?2.?lite|nano-banana-2-lite/, 0.0067, "Nano Banana 2 Lite"],
  [/nano.?banana.?2|nano-banana-2/, 0.0074, "Nano Banana 2"],
  [/nano.?banana/, 0.004, "Nano Banana"],
  [/gpt.?image.?1\.5|gpt-image\/1\.5/, 0.0073, "GPT Image 1.5"],
  [/gpt.?image/, 0.0063, "GPT Image 2 / 2.5"],
  [/seedream.?5.*flash/, 0.0053, "Seedream 5 Flash"],
  [/seedream.?5.*lite/, 0.0056, "Seedream 5 Lite"],
  [/seedream.?5/, 0.007, "Seedream 5 Pro"],
  [/seedream/, 0.0066, "Seedream 4.5"],
  [/qwen/, 0.0056, "Qwen 2"],
  [/z.?image/, 0.002, "Z Image"],
  [/product card.*anim/, 0.0068, "Product Card animation"],
  [/product card/, 0.0053, "Product Card"],
  [/upscale/, 0.0055, "Upscale"],
  [/face.?swap|expand|full.?angle|character/, 0.006, "Image tools"],
];

// Cost of a run when no credits were charged (unlimited plans), by model, at its usual settings.
const DEFAULT_RUN_COST = [
  [/grok/, 0.135], [/veo.*lite|veo3_lite/, 0.175], [/nano.?banana.?2.?1/, 0.02], [/nano.?banana.?2.?lite/, 0.02],
  [/nano.?banana.?2|nano-banana-2/, 0.04], [/gpt.?image/, 0.03], [/seedream/, 0.033], [/qwen/, 0.028], [/z.?image/, 0.004],
];

function family(g) {
  const key = `${g.kind || ""} ${g.provider || ""} ${g.model || ""}`.toLowerCase();
  const hit = COST_PER_CREDIT.find(([re]) => re.test(key));
  return hit ? { key, perCredit: hit[1], name: hit[2] } : { key, perCredit: null, name: g.provider || g.model || "Other" };
}

const per10 = (table, resolution, seconds) => (table[resolution] != null && seconds != null ? (table[resolution] / 10) * seconds : null);

// Exact cost from recorded settings, or null when the run did not record enough.
function exactCost(g, name) {
  const res = String(g.resolution || "").toLowerCase().replace(/^(\d+)$/, "$1p");
  const duration = num(g.duration), input = num(g.input_seconds) ?? 0, billed = num(g.billed_seconds);
  switch (name) {
    case "Veo 3.1 Lite": return { "720p": 0.15, "1080p": 0.175 }[res] ?? null;
    case "Veo 3.1 Fast": return { "720p": 0.3, "1080p": 0.325, "4k": 0.9 }[res] ?? null;
    case "Wan 3.0": {
      const seconds = billed ?? (duration != null ? duration + input : null);
      return per10({ "480p": 0.29, "720p": 0.58, "1080p": 1.16 }, res, seconds);
    }
    case "Seedance 2.5":
    case "Henshin": {
      if (duration == null && billed == null) return null;
      // "Make it 1080p" render of a draft: the no-video 1080p rate for output + original input seconds.
      if (g.is_final) return per10({ "1080p": 6.43 }, "1080p", billed ?? duration + Math.ceil(input));
      if (input > 0 || name === "Henshin") {
        const seconds = billed ?? Math.max(duration + Math.ceil(input), Math.ceil((5 * duration) / 3));
        return per10({ "480p": 0.712, "720p": 1.601, "1080p": 3.84 }, res, seconds);
      }
      return per10({ "480p": 1.19, "720p": 2.67, "1080p": 6.43 }, res, billed ?? duration);
    }
    case "Seedance 2.0": {
      const seconds = billed ?? (duration != null ? duration + Math.ceil(input) : null);
      return input > 0
        ? per10({ "480p": 0.431, "720p": 0.9375, "1080p": 2.325, "4k": 4.8 }, res, seconds)
        : per10({ "480p": 0.713, "720p": 1.538, "1080p": 3.825, "4k": 7.8 }, res, seconds);
    }
    case "Kling 4.0":
    case "Henshin Lite": {
      if (duration == null && billed == null) return null;
      const seconds = billed ?? (input > 0 ? Math.max(duration * 2, input + duration) : duration);
      const rate = input > 0 || name === "Henshin Lite" ? { "720p": 0.085, "1080p": 0.1275 }[res] : { "720p": 0.1425, "1080p": 0.2125 }[res];
      return rate != null ? rate * seconds : null;
    }
    case "Grok Video": {
      if (duration == null) return null;
      const rate = { "480p": 0.012, "720p": 0.0225, "1080p": 0.04 }[res];
      return rate != null ? rate * duration : null;
    }
    case "Nano Banana 2.1": return { "1k": 0.02, "2k": 0.03, "4k": 0.045 }[res] ?? null;
    case "Nano Banana 2": return { "1k": 0.04, "2k": 0.06, "4k": 0.09 }[res] ?? null;
    case "Nano Banana 2 Lite": return res === "1k" ? 0.02 : null;
    case "Nano Banana Pro": return { "1k": 0.09, "2k": 0.09, "4k": 0.12 }[res] ?? null;
    case "GPT Image 2 / 2.5": return { "1k": 0.03, "2k": 0.05, "4k": 0.08 }[res] ?? null;
    default: return null;
  }
}

// { usd, model, how } — how is "settings", "credits" or "default"; usd is 0 for failed runs and null when unknown.
export function runCost(g) {
  const fam = family(g);
  const status = String(g.status || "").toLowerCase();
  if (!DONE.has(status) && !g.has_result) return { usd: 0, model: fam.name, how: "failed" };
  const recorded = num(g.provider_cost_usd);
  if (recorded != null && recorded >= 0) return { usd: recorded, model: fam.name, how: "recorded" };
  const exact = exactCost(g, fam.name);
  if (exact != null) return { usd: exact, model: fam.name, how: "settings" };
  const credits = num(g.charged_cost);
  if (credits != null && credits > 0 && fam.perCredit != null) return { usd: credits * 10 * fam.perCredit, model: fam.name, how: "credits" };
  const fallback = DEFAULT_RUN_COST.find(([re]) => re.test(fam.key));
  if (fallback) return { usd: fallback[1], model: fam.name, how: "default" };
  if (credits != null && credits > 0) return { usd: credits * 10 * 0.0075, model: fam.name, how: "average" };
  return { usd: null, model: fam.name, how: "unknown" };
}
