// netlify/functions/audio-kie-callback.js
// Callback receiver for Hansora audio jobs from KIE / Suno.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return ok({ received:false, error:"Use POST" });

  try {
    const qs = event.queryStringParameters || {};
    const uid = String(qs.uid || "").trim();
    const run_id = String(qs.run_id || qs.runId || "").trim();
    const kind = String(qs.kind || "audio").trim();
    const body = safeJson(event.body);
    if (!uid || !run_id) return ok({ received:false, error:"missing_uid_or_run_id" });

    const oldRow = await readGenerationRow(uid, run_id);
    const oldMeta = oldRow?.meta || {};
    const taskId = extractTaskId(body) || oldMeta.task_id || oldMeta.taskId || "";
    const normalizedKind = String(kind).toLowerCase();
    const sunoStatus = normalizedKind === "music" ? normalizeSunoStatus(body) : "";
    const failed = normalizedKind === "music" ? sunoStatus === "failed" : isFailure(body);
    const imageUrls = extractImageUrls(body);
    const title = extractTitle(body) || oldMeta.title || providerTitle(kind);

    if (failed) {
      const reason = failureReason(body);
      const refund = oldRow ? await failAndRefundOnce({ row: oldRow, run_id, taskId, reason }) : { refunded:false };
      return ok({ received:true, status:"failed", run_id, taskId, refunded:!!refund.refunded, refund_amount:refund.amount || 0, error:reason });
    }

    if (normalizedKind === "music" && sunoStatus !== "success") {
      const meta = {
        ...(oldMeta || {}),
        run_id,
        status: "processing",
        task_id: taskId,
        audio_kind: kind,
        title,
        suno_stage: sunoStatus || "processing",
        callback: body
      };
      await patchGeneration(uid, run_id, { meta });
      return ok({ received:true, status:"processing", run_id, taskId, audioCount:0 });
    }

    const urls = normalizedKind === "music" ? extractSunoFinalAudioUrls(body, oldMeta) : extractAudioUrls(body, oldMeta);
    const firstUrl = urls[0] || "";
    const status = firstUrl ? "ready" : "processing";
    const meta = {
      ...(oldMeta || {}),
      run_id,
      status,
      task_id: taskId,
      audio_kind: kind,
      title,
      audio_url: firstUrl,
      audio_urls: urls,
      image_urls: imageUrls,
      suno_complete: normalizedKind === "music" && status === "ready",
      callback: body
    };

    await patchGeneration(uid, run_id, { result_url:firstUrl || null, meta });
    return ok({ received:true, status, run_id, taskId, audioCount:urls.length });
  } catch (e) {
    return ok({ received:false, error:String(e && e.message ? e.message : e) });
  }
};

function ok(obj){ return { statusCode:200, headers:cors(), body:JSON.stringify(obj) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" }; }
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function sb(){ return { "apikey":SERVICE_KEY, "Authorization":`Bearer ${SERVICE_KEY}` }; }
function providerTitle(kind){ return kind === "music" ? "Suno Music" : kind === "isolation" ? "Voice Isolation" : kind === "voice-change" ? "Voice Changer" : "Text to Voice"; }
function failureReason(body){ return String(body?.error || body?.message || body?.msg || body?.data?.errorMessage || body?.data?.failMsg || body?.data?.error || body?.data?.message || body?.data?.msg || "kie_failed"); }
function isFailure(body){
  const data = body?.data || body || {};
  const flag = data?.successFlag ?? body?.successFlag;
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return true;
  const status = String(data?.status || data?.state || body?.status || body?.state || "").trim().toLowerCase();
  return ["fail", "failed", "failure", "error", "errored", "canceled", "cancelled", "rejected", "blocked", "moderation_failed", "sensitive_word_error", "generate_audio_failed", "create_task_failed"].includes(status);
}
function normalizeSunoStatus(body){
  const data = body?.data || body || {};
  const raw = data?.status || data?.state || body?.status || body?.state || "";
  const status = String(raw).trim().toUpperCase();
  if (status === "SUCCESS") return "success";
  if (status === "FIRST_SUCCESS" || status === "TEXT_SUCCESS" || status === "PENDING" || status === "SUBMITTED" || status === "RUNNING" || status === "PROCESSING") return "pending";
  if (["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR", "FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "REJECTED", "BLOCKED"].includes(status)) return "failed";
  const flag = data?.successFlag ?? body?.successFlag;
  if (flag === 1 || flag === "1") return "success";
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return "failed";
  return "pending";
}

async function readGenerationRow(uid, run_id){
  try{
    if (!UG_URL || !SERVICE_KEY) return null;
    const q = `?select=id,user_id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers:sb() });
    const arr = await r.json().catch(()=>[]);
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch { return null; }
}
async function patchGeneration(uid, run_id, patch){
  if (!UG_URL || !SERVICE_KEY) return;
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
  await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify(patch) });
}
async function patchGenerationById(id, payload) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=minimal" }, body:JSON.stringify(payload) });
  return res.ok;
}
async function failAndRefundOnce({ row, run_id, taskId, reason }) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || meta.estimated_cost || 0);
  const failedMeta = { ...meta, run_id, task_id: taskId || meta.task_id || meta.taskId || "", status:"failed", failed:true, error:reason, failed_at:new Date().toISOString() };
  if (!Number.isFinite(amount) || amount <= 0 || !meta.charged) {
    await patchGenerationById(row.id, { meta:{ ...failedMeta, refund_skipped_reason:!meta.charged ? "not_charged" : "missing_refund_amount" } });
    return { refunded:false, amount:0 };
  }
  const claim = `audio_refund_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimRes = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method:"PATCH",
    headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=representation" },
    body:JSON.stringify({ result_url:null, meta:{ ...failedMeta, refund_claim:claim } })
  });
  const claimedRows = await claimRes.json().catch(()=>[]);
  if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) return { refunded:false, amount, already_claimed:true };
  const profileRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, { headers:sb() });
  const profiles = await profileRes.json().catch(()=>[]);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=minimal" }, body:JSON.stringify({ credits:nextCredits }) });
  if (!updateRes.ok) {
    await patchGenerationById(row.id, { meta:{ ...failedMeta, refund_claim:claim, refund_error:"profile_refund_failed" } });
    return { refunded:false, amount, error:"profile_refund_failed" };
  }
  await patchGenerationById(row.id, { meta:{ ...failedMeta, refund_claim:claim, refunded:true, refunded_cost:amount, refunded_at:new Date().toISOString() } });
  return { refunded:true, amount, credits:nextCredits };
}
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.task_id) return String(data.data.task_id);
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.task_id) return String(data.task_id);
  if (data?.taskId) return String(data.taskId);
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id|record[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
        const s=String(v); if (s.length > 3) return s;
      }
      const inner=scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
function normalizeComparableUrl(url){ return String(url || "").replace(/[)"'\\\]}]+$/g, "").trim(); }
function isBlockedUrl(url){
  const clean = normalizeComparableUrl(url).toLowerCase();
  return !clean || clean.includes("/.netlify/functions/audio-kie-callback") || clean.includes("/.netlify/functions/run-audio") || clean.includes("/api/callback") || clean.includes("callback");
}
function collectKnownInputUrls(meta){
  const urls = [];
  const seen = new Set();
  function add(url){
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || seen.has(clean)) return;
    seen.add(clean); urls.push(clean);
  }
  function walk(value, trusted=false, depth=0){
    if (!value || depth > 8) return;
    if (typeof value === "string") {
      const parsed = safeJson(value);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, trusted, depth + 1);
      if (trusted) (value.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(value)) return value.forEach((item)=>walk(item, trusted, depth + 1));
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, trusted || /^(request|input|audio_url|audioUrl|source|reference)$/i.test(key), depth + 1);
    }
  }
  walk(meta?.request, true);
  walk(meta?.input, true);
  return urls;
}
function extractSunoFinalAudioUrls(data, oldMeta = {}){
  const urls = [];
  const seen = new Set();
  const excluded = collectKnownInputUrls(oldMeta).map(normalizeComparableUrl).filter(Boolean);
  const finalAudioKeys = new Set(["audioUrl", "audio_url", "downloadUrl", "download_url", "sourceAudioUrl", "source_audio_url", "originAudioUrl", "origin_audio_url"]);
  const containerKeys = new Set(["data", "result", "results", "response", "sunoData", "tracks", "songs", "items"]);
  function add(url){
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    const lower = clean.toLowerCase();
    if (!clean || isBlockedUrl(clean) || excluded.includes(clean) || seen.has(clean)) return;
    if (lower.includes("streamaudiourl") || lower.includes("stream_audio")) return;
    seen.add(clean); urls.push(clean);
  }
  function scan(x, trusted=false, depth=0){
    if (!x || depth > 10 || urls.length >= 4) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return scan(parsed, trusted, depth + 1);
      if (trusted) (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item)=>scan(item, trusted, depth + 1));
    if (typeof x === "object") {
      for (const [key, child] of Object.entries(x)) {
        if (/streamAudioUrl|stream_audio_url/i.test(key)) continue;
        const nextTrusted = trusted || finalAudioKeys.has(String(key || ""));
        if (nextTrusted || containerKeys.has(String(key || ""))) scan(child, nextTrusted, depth + 1);
      }
    }
  }
  scan(data);
  return urls.slice(0,4);
}


function extractAudioUrls(data, oldMeta = {}){
  const urls = [];
  const seen = new Set();
  const excluded = collectKnownInputUrls(oldMeta).map(normalizeComparableUrl).filter(Boolean);
  const outputKeys = new Set(["audio_url", "audioUrl", "audioURL", "sourceAudioUrl", "downloadUrl", "download_url", "fileUrl", "file_url", "mediaUrl", "media_url", "resultUrl", "result_url", "url", "urls", "output", "outputs", "audio", "audios", "sunoData", "tracks", "data"]);
  const containerKeys = new Set(["data", "result", "results", "response", "task", "job", "output", "outputs", "sunoData", "tracks"]);
  const blockedKey = /(callback|callBackUrl|callbackUrl|input|request|payload|params|parameters|metadata|meta|reference)/i;
  function add(url){
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || isBlockedUrl(clean) || excluded.includes(clean) || seen.has(clean)) return;
    seen.add(clean); urls.push(clean);
  }
  function scan(x, trusted=false, depth=0){
    if (!x || depth > 10 || urls.length >= 8) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return scan(parsed, trusted, depth + 1);
      if (trusted) (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item)=>scan(item, trusted, depth + 1));
    if (typeof x === "object") {
      for (const [key, child] of Object.entries(x)) {
        if (blockedKey.test(key) && !/^(audio_url|audioUrl|audioURL|sourceAudioUrl)$/i.test(key)) continue;
        const nextTrusted = trusted || outputKeys.has(key);
        if (nextTrusted || containerKeys.has(key)) scan(child, nextTrusted, depth + 1);
      }
    }
  }
  scan(data);
  return urls.slice(0,4);
}
function extractImageUrls(data){
  const urls = [];
  const seen = new Set();
  function add(url){
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || isBlockedUrl(clean)) return;
    if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(clean) && !/image/i.test(clean)) return;
    if (!seen.has(clean)) { seen.add(clean); urls.push(clean); }
  }
  function scan(x, depth=0){
    if (!x || depth > 10) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return scan(parsed, depth + 1);
      (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item)=>scan(item, depth + 1));
    if (typeof x === "object") Object.values(x).forEach((v)=>scan(v, depth + 1));
  }
  scan(data);
  return urls;
}
function extractTitle(data){
  if (!data || typeof data !== "object") return "";
  const direct = data?.data?.title || data?.title;
  if (direct) return String(direct).slice(0,120);
  if (Array.isArray(data?.data?.response?.sunoData) && data.data.response.sunoData[0]?.title) return String(data.data.response.sunoData[0].title).slice(0,120);
  return "";
}
