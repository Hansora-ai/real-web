// netlify/functions/run-image-tools.js
// Submit Hansora Image Tools tasks to KIE: different-angles => gpt-image-2-image-to-image, expand => nano-banana-pro.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_BASE

const KIE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const API_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";
const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/, "");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/image-tools-check`;
const FIXED_COST = 1.5;

const ANGLES_PROMPT = `Create a professional photorealistic character reference sheet (character turnaround sheet) of the SAME person from the uploaded reference photo(s). If multiple reference images are provided, carefully analyze ALL of them together to build a complete and accurate understanding of the person's appearance, face, hair, clothing and accessories from different angles, and use this combined information to generate the turnaround consistently.

CRITICAL — preserve identity 100%:
Keep the face absolutely identical to the reference: same facial features, same face shape, same eye shape and color, same nose, same lips, same eyebrows, same skin tone, same age, same makeup (if any).
Keep the hair 100% identical: same color, same length, same hairstyle, same parting, same texture, same volume.
Do NOT beautify, do NOT change proportions, do NOT make the person younger or older, do NOT alter ethnicity. The person must be perfectly recognizable in every shot.
CRITICAL — preserve outfit and accessories EXACTLY as in the reference:

Keep the clothing 100% identical to the reference photo(s): same garment, same color, same cut, same fabric, same details, same prints, same stripes, same logos, same brooches/pins, same neckline. Do not add a jacket, blazer, scarf, hat, sunglasses or any other clothing item that is not visible in the reference.
Keep all accessories 100% identical: same earrings, same necklace, same rings, same watch, same brooch — exactly as shown in the reference.
Do NOT add any new accessories. Do NOT remove existing accessories.
If only the upper body is visible in the reference, logically extend the outfit downward in a neutral, realistic way that matches the style and color palette of the visible clothing (for example simple matching trousers/skirt and plain shoes), keeping it minimal and non-distracting.
Style: hyper-realistic photography, studio quality, 8K, sharp focus, professional color grading, cinematic soft lighting, shot on Hasselblad, 85mm lens, clean neutral light grey studio background, soft even lighting without harsh shadows. Consistent lighting and background across all 6 shots.

COMPOSITION — single reference sheet, overall canvas aspect ratio 16:9 (horizontal), divided into a strict, clean grid with thin neutral dividers between panels:

LEFT HALF of the canvas (occupies 50% of the width, full height) — split vertically into 2 EQUAL TALL VERTICAL PANELS (full-body shots, head to toes, character fills the panel from top to bottom with small headroom):

Left vertical panel — Full body, FRONT view: standing straight, natural relaxed confident pose, arms relaxed at sides, looking at camera.
Right vertical panel — Full body, BACK view: exact same standing pose seen from directly behind, same scale and same vertical alignment as the front view, showing the back of the outfit and hair.
RIGHT HALF of the canvas (occupies the other 50% of the width, full height) — split into a 2x2 GRID of 4 EQUAL PANELS (close-up portraits, head and shoulders, tight framing on the face):
3) Top-left panel — Face CLOSE-UP, FRONT view: head and shoulders, looking straight at camera, neutral calm expression.
4) Top-right panel — Head CLOSE-UP, BACK view: directly from behind, showing the back of the head and hairstyle in full detail.
5) Bottom-left panel — Face CLOSE-UP, THREE-QUARTER view from the RIGHT side (face turned slightly so we see more of the right side of the face).
6) Bottom-right panel — Face CLOSE-UP, THREE-QUARTER view from the LEFT side (face turned slightly so we see more of the left side of the face).

All 6 shots must show the SAME person, SAME outfit, SAME accessories, SAME hairstyle, SAME lighting, SAME background — only the camera angle and framing changes. Consistent character design across all frames, like an official movie character turnaround or a fashion lookbook.

Layout rules: keep the 16:9 master frame; left side = 2 vertical full-body panels of equal width and full height; right side = 2x2 grid of equal close-up panels; thin clean separators between all panels; no text, no labels, no watermarks, no logos, no extra characters, no duplicates of the person inside a single panel.

Ultra-detailed, photorealistic skin texture, realistic fabric texture, realistic hair strands, natural shadows. The final result must look like six real photographs of the same real person taken in one studio session, assembled into one professional 16:9 character reference sheet.`;

const EXPAND_PROMPT = "Expand the provided image outward while preserving everything inside the original image exactly. Keep the same subject, identity, face, body, clothing, colors, lighting, shadows, camera angle, perspective, background style, texture, mood, and composition continuity. Do not alter, replace, beautify, distort, crop, repaint, or move the original visible content. Only extend the canvas naturally beyond the current edges with realistic matching details, seamless perspective, consistent depth, matching environment, clean edges, no duplicated artifacts, no text, no watermark, no extra subjects unless they already logically continue from the original scene. The final image must look like the same real photo with a larger frame, not a new image.";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");
  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);
    const uid = String(body.uid || body.user_id || "").trim();
    if (!uid) return ok({ submitted: false, error: "missing_uid" });

    const authz = String(headers.authorization || "");
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted: false, error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted: false, error: "auth_mismatch" });

    const tool = normalizeTool(body.tool || body.mode || body.feature || "different_angles");
    const imageUrls = normalizeImageUrls(body.imageUrls || body.image_urls || body.fileUrls || body.file_urls || body.fileUrl || body.file_url || body.url);
    if (!imageUrls.length) return ok({ submitted: false, error: "missing_image_url" });
    if (tool === "different_angles" && imageUrls.length > 2) return ok({ submitted: false, error: "different_angles_accepts_1_to_2_images" });
    if (tool === "expand" && imageUrls.length > 1) return ok({ submitted: false, error: "expand_accepts_1_image" });

    const run_id = String(body.run_id || body.runId || `${uid}-image-tools-${Date.now()}`).trim();
    const fileName = String(body.fileName || body.file_name || "uploaded-image").trim().slice(0, 180);
    const fileType = String(body.fileType || body.file_type || "image").trim().slice(0, 120);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio || body.aspect_ratio || (tool === "different_angles" ? "16:9" : "auto"), tool);
    const resolution = "2K";
    const cost = FIXED_COST;
    const prompt = tool === "different_angles" ? ANGLES_PROMPT : EXPAND_PROMPT;
    const provider = tool === "different_angles" ? "gpt-image-2-image-to-image" : "nano-banana-pro";
    const kieModel = tool === "different_angles" ? "gpt-image-2-image-to-image" : "nano-banana-pro";
    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}`;

    const existing = await getExistingTask(uid, run_id);
    if (existing && existing.taskId) return ok({ submitted: true, run_id, taskId: existing.taskId, already: true });

    await seedPlaceholder(uid, run_id, {
      provider,
      prompt,
      fileName,
      fileType,
      imageUrls,
      tool,
      cost,
      aspectRatio,
      resolution
    });

    const kiePayload = {
      model: kieModel,
      callBackUrl,
      input: tool === "different_angles"
        ? {
            prompt,
            input_urls: imageUrls,
            aspect_ratio: aspectRatio
          }
        : {
            prompt,
            image_input: imageUrls,
            aspect_ratio: aspectRatio,
            resolution,
            output_format: "png"
          }
    };

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const data = await resp.json().catch(() => ({}));
    const taskId = extractTaskId(data);
    if (!resp.ok) {
      await markCreateFailed(uid, run_id, `kie_${resp.status}`, data);
      return ok({ submitted: false, error: `kie_${resp.status}`, data, run_id });
    }
    if (data && typeof data === "object" && data.code && Number(data.code) !== 200) {
      await markCreateFailed(uid, run_id, data.msg || "kie_create_failed", data);
      return ok({ submitted: false, error: "kie_create_failed", data, run_id });
    }
    if (!taskId) {
      await markCreateFailed(uid, run_id, "missing_taskId", data);
      return ok({ submitted: false, error: "missing_taskId", data, run_id });
    }

    if (!(await isCharged(uid, run_id))) {
      const debited = await debitCredits(uid, cost);
      if (!debited) return ok({ submitted: false, error: "debit_failed", run_id, taskId });
      await markCharged(uid, run_id, cost, taskId);
    }
    await patchTaskMeta(uid, run_id, { task_id: taskId, status: "processing", kie_model: kiePayload.model });
    return ok({ submitted: true, run_id, taskId, status: resp.status, data });
  } catch (error) {
    return ok({ submitted: false, error: messageOf(error) });
  }
};

function normalizeTool(value) {
  const s = String(value || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (s.includes("expand")) return "expand";
  return "different_angles";
}
function normalizeImageUrls(value) {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.map(normalizeUrl).filter(Boolean))];
}
function normalizeAspectRatio(value, tool) {
  if (tool === "different_angles") return "16:9";
  const allowed = new Set(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]);
  const s = String(value || "auto").trim();
  return allowed.has(s) ? s : "auto";
}
function ok(obj) { return { statusCode: 200, headers: cors(), body: JSON.stringify(obj) }; }
function err(code, message) { return { statusCode: code, headers: cors(), body: JSON.stringify({ submitted: false, error: message }) }; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID" }; }
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function lowerKeys(h) { const out = {}; for (const k in h) out[k.toLowerCase()] = h[k]; return out; }
function normalizeUrl(value) { try { return new URL(String(value || "")).href; } catch { return ""; } }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }

async function verifyUser(token) {
  try {
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const res = await fetch(AUTH_USER_URL, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
}
async function seedPlaceholder(uid, run_id, data) {
  try {
    if (!UG_URL || !SERVICE_KEY) return;
    const check = await fetch(`${UG_URL}?select=id&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`, { headers: sb() });
    const arr = await check.json().catch(() => []);
    if (Array.isArray(arr) && arr.length) return;
    const payload = {
      user_id: uid,
      provider: data.provider,
      kind: "image_tools",
      prompt: data.prompt,
      result_url: null,
      meta: {
        run_id,
        status: "processing",
        media_type: "image",
        tool: data.tool,
        input_url: data.imageUrls[0] || "",
        input_urls: data.imageUrls,
        file_name: data.fileName,
        file_type: data.fileType,
        refund_amount: data.cost,
        charged_cost: data.cost,
        aspect_ratio: data.aspectRatio,
        resolution: data.resolution
      }
    };
    await fetch(UG_URL, { method: "POST", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(payload) });
  } catch (e) { console.warn("[run-image-tools] seed failed", e); }
}
async function patchTaskMeta(uid, run_id, extraMeta) {
  try {
    const current = await getRow(uid, run_id);
    const meta = { ...(current && current.meta && typeof current.meta === "object" ? current.meta : {}), run_id, ...extraMeta };
    await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ meta }) });
  } catch {}
}
async function markCreateFailed(uid, run_id, reason, data) {
  await patchTaskMeta(uid, run_id, {
    status: "failed",
    failed: true,
    error: reason,
    kie_error: data || null,
    failed_at: new Date().toISOString()
  });
}
async function getRow(uid, run_id) {
  try {
    const res = await fetch(`${UG_URL}?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch { return null; }
}
async function getCredits(uid) {
  try {
    const res = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const credits = Number(Array.isArray(arr) && arr[0] ? arr[0].credits : 0);
    return Number.isFinite(credits) ? credits : 0;
  } catch { return 0; }
}
async function debitCredits(uid, cost) {
  try {
    const cur = await getCredits(uid);
    if (cur < cost) return false;
    const next = Math.round((cur - cost) * 100) / 100;
    const res = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ credits: next }) });
    return res.ok;
  } catch { return false; }
}
async function getExistingTask(uid, run_id) {
  const row = await getRow(uid, run_id);
  const taskId = row && row.meta ? (row.meta.task_id || row.meta.taskId || "") : "";
  return row ? { id: row.id, taskId: String(taskId || "") } : null;
}
async function isCharged(uid, run_id) {
  const row = await getRow(uid, run_id);
  const meta = row && row.meta ? row.meta : {};
  return meta.charged === true || meta.charged === "true";
}
async function markCharged(uid, run_id, cost, taskId) {
  try {
    const current = await getRow(uid, run_id);
    const meta = { ...(current && current.meta && typeof current.meta === "object" ? current.meta : {}), charged: true, charged_cost: cost, refund_amount: cost, task_id: taskId, run_id, status: "processing" };
    await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`, { method: "PATCH", headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ meta }) });
  } catch {}
}
function extractTaskId(data) {
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.taskId) return String(data.taskId);
  if (data?.data?.task_id) return String(data.data.task_id);
  const seen = new Set();
  function scan(x) {
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k, v] of Object.entries(x)) {
      if (/^(task[_-]?id|request[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) return String(v);
      const inner = scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data);
}
