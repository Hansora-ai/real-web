// netlify/functions/audio-check.js
// Checker/refunder for Hansora audio jobs: ElevenLabs market jobs + Suno music jobs.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Use GET" });

    const qs = event.queryStringParameters || {};
    const ids = {
      uid: String(qs.uid || "").trim(),
      run_id: String(qs.run_id || qs.runId || "").trim(),
      taskId: String(qs.taskId || qs.task_id || "").trim()
    };

    const row = await findAudioGeneration(ids);
    if (!row) return json(200, { ok: false, status: "ignored", reason: "not_found" });

    ids.uid = ids.uid || row.user_id || "";
    ids.run_id = ids.run_id || row.meta?.run_id || "";
    ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || "";
    if (!ids.taskId) return json(200, { ok: false, status: "pending", error: "missing_task_id" });

    const audioKind = String(row.meta?.audio_kind || row.meta?.kind || "").toLowerCase();
    const state = audioKind === "music" ? await fetchSunoState(ids.taskId) : await fetchMarketState(ids.taskId);

    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || "kie_failed" });
      return json(200, { ok: false, failed: true, status: "failed", error: state.error || "kie_failed", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
    }

    if (state.done && state.audioUrls.length) {
      await markDone({ row, ids, state });
      return json(200, { ok: true, status: "done", result_url: state.audioUrls[0], audio_url: state.audioUrls[0], audio_urls: state.audioUrls, image_urls: state.imageUrls || [] });
    }

    return json(200, { ok: false, status: "pending" });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error) });
  }
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,OPTIONS" };
}
function json(statusCode, body) { return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) }; }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function safeJson(raw) { if (!raw) return {}; try { return JSON.parse(raw); } catch { return {}; } }
function messageOf(error) { return error && error.message ? error.message : String(error); }

async function findAudioGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const select = "select=id,user_id,provider,kind,result_url,meta,prompt,created_at";
  const queries = [];
  if (ids.uid && ids.run_id) queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&kind=eq.audio&${select}&limit=1`);
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&kind=eq.audio&${select}&limit=1`);
    queries.push(`?meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&kind=eq.audio&${select}&limit=1`);
  }
  for (const query of queries) {
    const res = await fetch(UG_URL + query, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const row = Array.isArray(arr) ? arr[0] : null;
    if (row) return row;
  }
  return null;
}

async function fetchMarketState(taskId) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };
  const paths = [
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`
  ];
  return await fetchFirstFinished(paths);
}

async function fetchSunoState(taskId) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };
  const paths = [
    `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/generate/record-info?task_id=${encodeURIComponent(taskId)}`
  ];
  return await fetchFirstFinished(paths);
}

async function fetchFirstFinished(paths) {
  let sawFailed = false;
  let failReason = "";
  for (const path of paths) {
    try {
      const res = await fetch(KIE_BASE + path, { headers: { Accept: "application/json", Authorization: `Bearer ${KIE_KEY}` } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      const status = normalizeStatus(data);
      if (status === "failed") {
        sawFailed = true;
        failReason = failReason || failureReason(data);
        continue;
      }
      const audioUrls = collectAudioUrls(data);
      const imageUrls = collectImageUrls(data);
      if ((status === "done" || audioUrls.length) && audioUrls.length) return { done: true, audioUrls, imageUrls, raw: data };
    } catch (error) {
      failReason = failReason || messageOf(error);
    }
  }
  if (sawFailed) return { failed: true, error: failReason || "kie_failed" };
  return { pending: true };
}

async function markDone({ row, ids, state }) {
  const meta = {
    ...(row.meta && typeof row.meta === "object" ? row.meta : {}),
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || "",
    status: "ready",
    audio_url: state.audioUrls[0],
    audio_urls: state.audioUrls,
    image_urls: state.imageUrls || [],
    completed_at: new Date().toISOString()
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: state.audioUrls[0], meta })
  });
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || meta.estimated_cost || 0);
  const failedMeta = { ...meta, run_id: ids.run_id || meta.run_id || "", task_id: ids.taskId || meta.task_id || meta.taskId || "", status: "failed", failed: true, error: reason, failed_at: new Date().toISOString() };

  if (!Number.isFinite(amount) || amount <= 0 || !meta.charged) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_skipped_reason: !meta.charged ? "not_charged" : "missing_refund_amount" } });
    return { refunded: false, amount: 0 };
  }

  const claim = `audio_refund_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimRes = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ result_url: null, meta: { ...failedMeta, refund_claim: claim } })
  });
  const claimedRows = await claimRes.json().catch(() => []);
  if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) return { refunded: false, amount, already_claimed: true };

  const profileRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, { headers: sb() });
  const profiles = await profileRes.json().catch(() => []);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateRes = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ credits: nextCredits })
  });
  if (!updateRes.ok) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_claim: claim, refund_error: "profile_refund_failed" } });
    return { refunded: false, amount, error: "profile_refund_failed" };
  }
  await patchGeneration(row.id, { meta: { ...failedMeta, refund_claim: claim, refunded: true, refunded_cost: amount, refunded_at: new Date().toISOString() } });
  return { refunded: true, amount, credits: nextCredits };
}

async function patchGeneration(id, payload) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

function normalizeStatus(value) {
  const data = value?.data || value;
  const state = String(data?.state || data?.status || value?.status || "").toLowerCase();
  if (["success", "succeeded", "completed", "complete", "done", "ready"].includes(state)) return "done";
  if (String(data?.status || "").toUpperCase() === "SUCCESS") return "done";
  if (/(create_task_failed|generate_audio_failed|callback_exception|sensitive_word_error|fail|failed|error|cancel|rejected|blocked)/i.test(state)) return "failed";
  const flag = value?.data?.successFlag ?? value?.successFlag ?? value?.result?.successFlag;
  if (flag === 1 || flag === "1") return "done";
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return "failed";
  const text = JSON.stringify(value || {}).toLowerCase();
  if (/(fail|failed|failure|error|errored|cancel|canceled|cancelled|rejected|moderation|blocked|sensitive|flagged)/.test(text)) return "failed";
  if (/(success|succeeded|completed|complete|finished|done)/.test(text)) return "done";
  return "pending";
}

function failureReason(value) {
  return String(value?.error || value?.message || value?.msg || value?.data?.errorMessage || value?.data?.failMsg || value?.data?.error || value?.data?.message || value?.result?.error || value?.result?.message || "kie_failed");
}

function collectAudioUrls(value) {
  const urls = [];
  const seen = new Set();
  const keys = /^(audioUrl|audio_url|streamAudioUrl|stream_audio_url|sourceAudioUrl|source_audio_url|result_url|url|downloadUrl|download_url|fileUrl|file_url)$/i;
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\\\]}]+$/g, "").trim();
    if (!/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i.test(clean) && !/audio/i.test(clean)) return;
    if (!seen.has(clean)) { seen.add(clean); urls.push(clean); }
  }
  function walk(x, trusted = false, depth = 0) {
    if (!x || depth > 10 || urls.length >= 6) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, trusted, depth + 1);
      if (trusted) (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) { x.forEach((item) => walk(item, trusted, depth + 1)); return; }
    if (typeof x === "object") {
      for (const [k, v] of Object.entries(x)) walk(v, trusted || keys.test(k) || /sunoData|response|resultJson|data|output|outputs|files/i.test(k), depth + 1);
    }
  }
  walk(value);
  return urls;
}

function collectImageUrls(value) {
  const urls = [];
  const seen = new Set();
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\\\]}]+$/g, "").trim();
    if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(clean) && !/image/i.test(clean)) return;
    if (!seen.has(clean)) { seen.add(clean); urls.push(clean); }
  }
  function walk(x, depth = 0) {
    if (!x || depth > 10 || urls.length >= 6) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, depth + 1);
      (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) { x.forEach((item) => walk(item, depth + 1)); return; }
    if (typeof x === "object") Object.values(x).forEach((v) => walk(v, depth + 1));
  }
  walk(value);
  return urls;
}
