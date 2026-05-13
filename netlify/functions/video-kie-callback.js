// netlify/functions/video-kie-callback.js
// Robust KIE video webhook + polling checker.
// - POST: receives KIE callbacks and saves success/failure.
// - GET: lets the page re-check a task if the user left and came back.
// - Refunds once through the refund_ledger-backed Supabase RPC.

const { refundGenerationOnce } = require("./_refunds");

const VERSION = "video-kie-callback-2026-05-13+failure-check";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const KIE_API_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");

const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const TABLE_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/nb_results` : "";

const ALLOWED = new Set([
  "tempfile.aiquickdraw.com",
  "tempfile.redpandaai.co",
  "file.aiquickdraw.com"
]);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };

  const qs = event.queryStringParameters || {};
  const debug = qs.debug === "1" || qs.debug === "true";

  try {
    if (event.httpMethod === "GET") return await handleGet(qs, debug);
    if (event.httpMethod === "POST") return await handlePost(event, qs, debug);
    return json(405, { ok: false, error: "Use GET or POST", version: VERSION });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error), version: VERSION });
  }
};

async function handlePost(event, qs, debug) {
  const body = safeJson(event.body);
  const ids = extractIds(body, qs);
  const status = normalizeStatus(body);
  const row = await findGeneration(ids);

  if (status === "failed") {
    const reason = failureReason(body);
    const result = row ? await markFailedAndRefundOnce({ row, ids, reason }) : { refunded: false, reason: "row not found" };
    return json(200, {
      ok: false,
      failed: true,
      status: "failed",
      error: reason,
      refunded: !!result.refunded,
      version: VERSION,
      ...(debug ? { debug: { ids, result } } : {})
    });
  }

  const videoUrl = pickVideoUrl(collectUrls(body));
  if (!videoUrl) {
    return json(200, {
      ok: false,
      status: "pending",
      taskId: ids.taskId || null,
      version: VERSION,
      ...(debug ? { debug: { ids, normalizedStatus: status } } : {})
    });
  }

  const saved = await markDone({ row, ids, videoUrl, provider: "kie-video" });
  await mirrorNbResult({ ids, url: videoUrl });

  return json(200, {
    ok: true,
    status: "done",
    video_url: videoUrl,
    result_url: videoUrl,
    version: VERSION,
    ...(debug ? { debug: { ids, saved } } : {})
  });
}

async function handleGet(qs, debug) {
  let ids = {
    uid: String(qs.uid || "").trim(),
    run_id: String(qs.run_id || "").trim(),
    taskId: String(qs.taskId || qs.task_id || "").trim()
  };

  let row = await findGeneration(ids);
  if (row) {
    const meta = row.meta || {};
    ids = {
      uid: ids.uid || row.user_id || "",
      run_id: ids.run_id || meta.run_id || "",
      taskId: ids.taskId || meta.task_id || meta.taskId || ""
    };

    if (row.result_url) {
      return json(200, {
        ok: true,
        status: "done",
        video_url: row.result_url,
        result_url: row.result_url,
        version: VERSION
      });
    }

    const rowStatus = String(meta.status || row.status || "").toLowerCase();
    if (rowStatus.includes("fail") || meta.failed) {
      return json(200, {
        ok: false,
        failed: true,
        status: "failed",
        error: meta.error || "Generation failed.",
        refunded: !!meta.refunded,
        version: VERSION
      });
    }
  }

  if (!ids.taskId) {
    return json(200, { ok: false, status: "pending", error: "Missing taskId", version: VERSION });
  }

  const state = await fetchKieState(ids.taskId);
  if (state.failed) {
    row = row || await findGeneration(ids);
    const result = row ? await markFailedAndRefundOnce({ row, ids, reason: state.error || "Generation failed." }) : null;
    return json(200, {
      ok: false,
      failed: true,
      status: "failed",
      error: state.error || "Generation failed.",
      refunded: !!(result && result.refunded),
      version: VERSION,
      ...(debug ? { debug: { ids, state, result } } : {})
    });
  }

  if (state.done && state.url) {
    row = row || await findGeneration(ids);
    const saved = await markDone({ row, ids, videoUrl: state.url, provider: "kie-video" });
    await mirrorNbResult({ ids, url: state.url });
    return json(200, {
      ok: true,
      status: "done",
      video_url: state.url,
      result_url: state.url,
      version: VERSION,
      ...(debug ? { debug: { ids, state, saved } } : {})
    });
  }

  return json(200, {
    ok: false,
    status: "pending",
    taskId: ids.taskId,
    version: VERSION,
    ...(debug ? { debug: { ids, state } } : {})
  });
}

async function fetchKieState(taskId) {
  if (!KIE_API_KEY) return { pending: true, error: "Missing KIE_API_KEY" };

  const endpoints = [
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/getTask?taskId=${encodeURIComponent(taskId)}`
  ];

  let last = null;
  for (const path of endpoints) {
    try {
      const res = await fetch(KIE_BASE + path, {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${KIE_API_KEY}`
        }
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      last = { http: res.status, data };
      if (!res.ok && res.status !== 404) continue;

      const status = normalizeStatus(data);
      if (status === "failed") return { failed: true, error: failureReason(data), rawStatus: status };

      const urls = collectUrls(data);
      const videoUrl = pickVideoUrl(urls);
      if (status === "done" && videoUrl) return { done: true, url: videoUrl, rawStatus: status };
      if (videoUrl) return { done: true, url: videoUrl, rawStatus: status || "done" };
    } catch (error) {
      last = { error: messageOf(error) };
    }
  }

  return { pending: true, last };
}

async function findGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;

  const select = "select=id,user_id,provider,kind,prompt,result_url,meta";
  const queries = [];

  if (ids.uid && ids.run_id) {
    queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  }
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }

  for (const q of queries) {
    const res = await fetch(UG_URL + q, { headers: sb() });
    const arr = await res.json().catch(() => []);
    if (Array.isArray(arr) && arr[0]) return arr[0];
  }
  return null;
}

async function markDone({ row, ids, videoUrl, provider }) {
  if (!UG_URL || !SERVICE_KEY) return { ok: false, error: "Missing Supabase env" };

  const meta = {
    ...(row && row.meta && typeof row.meta === "object" ? row.meta : {}),
    run_id: ids.run_id || (row && row.meta && row.meta.run_id) || "",
    task_id: ids.taskId || (row && row.meta && (row.meta.task_id || row.meta.taskId)) || "",
    status: "done",
    completed_at: new Date().toISOString()
  };

  const payload = { result_url: videoUrl, meta };
  if (row && row.id) {
    const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status, mode: "patch" };
  }

  const res = await fetch(UG_URL, {
    method: "POST",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify({
      user_id: ids.uid || "00000000-0000-0000-0000-000000000000",
      provider,
      kind: "video",
      prompt: null,
      result_url: videoUrl,
      meta
    })
  });
  return { ok: res.ok, status: res.status, mode: "insert" };
}

async function markFailedAndRefundOnce({ row, ids, reason }) {
  if (!row || !row.id || !UG_URL || !SERVICE_KEY) return { refunded: false, reason: "missing row/env" };

  const existingMeta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const failedMeta = {
    ...existingMeta,
    run_id: ids.run_id || existingMeta.run_id || "",
    task_id: ids.taskId || existingMeta.task_id || existingMeta.taskId || "",
    status: "failed",
    failed: true,
    error: reason || "Generation failed.",
    failed_at: new Date().toISOString()
  };

  if (existingMeta.refunded) {
    await patchGeneration(row.id, { meta: failedMeta });
    return { refunded: false, already_refunded: true };
  }

  await patchGeneration(row.id, { meta: failedMeta });
  return await refundGenerationOnce({
    generationId: row.id,
    reason: reason || "Generation failed.",
    source: "video-kie-callback"
  });
}

async function patchGeneration(id, payload) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

async function mirrorNbResult({ ids, url }) {
  try {
    if (!TABLE_URL || !url) return;
    await fetch(TABLE_URL, {
      method: "POST",
      headers: { ...sb(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        user_id: ids.uid || "00000000-0000-0000-0000-000000000000",
        run_id: ids.run_id || "",
        task_id: ids.taskId || "",
        image_url: url
      }])
    });
  } catch {}
}

function extractIds(body, qs) {
  const meta = body?.meta || body?.metadata || body?.data?.meta || body?.data?.metadata || body?.result?.meta || {};
  return {
    uid: String(qs.uid || body?.uid || body?.data?.uid || meta.uid || "").trim(),
    run_id: String(qs.run_id || body?.run_id || body?.data?.run_id || meta.run_id || "").trim(),
    taskId: String(qs.taskId || qs.task_id || body?.taskId || body?.task_id || body?.data?.taskId || body?.data?.task_id || body?.result?.taskId || body?.id || "").trim()
  };
}

function normalizeStatus(x) {
  const values = [];
  collectStatusValues(x, values);
  const joined = values.join(" ").toLowerCase();
  if (/(fail|failed|failure|error|cancel|canceled|cancelled|rejected|sensitive|flagged|blocked|moderation)/.test(joined)) return "failed";
  if (/(success|succeeded|completed|complete|finish|finished|done)/.test(joined)) return "done";
  return "pending";
}

function collectStatusValues(x, out) {
  if (!x || out.length > 32) return;
  if (typeof x === "string") {
    if (/fail|error|success|complete|finish|done|pending|process|sensitive|flagged|rejected|blocked|cancel/i.test(x)) out.push(x);
    return;
  }
  if (Array.isArray(x)) {
    x.forEach((v) => collectStatusValues(v, out));
    return;
  }
  if (typeof x === "object") {
    for (const [key, value] of Object.entries(x)) {
      if (/status|state|error|message|msg|reason|code/i.test(key)) collectStatusValues(value, out);
    }
  }
}

function failureReason(x) {
  const messages = [];
  collectFailureMessages(x, messages);
  const preferred = messages.find((msg) => msg && !/^(fail|failed|failure|error|cancel|cancelled|rejected)$/i.test(msg.trim()));
  return preferred || messages.find(Boolean) || "Generation failed.";
}

function collectFailureMessages(x, out) {
  if (!x || out.length > 24) return;
  if (typeof x === "string") {
    if (/fail|error|sensitive|flagged|rejected|blocked|cancel/i.test(x)) out.push(x.slice(0, 500));
    return;
  }
  if (Array.isArray(x)) {
    x.forEach((v) => collectFailureMessages(v, out));
    return;
  }
  if (typeof x === "object") {
    const entries = Object.entries(x);
    for (const [key, value] of entries) {
      if (/error|message|msg|reason/i.test(key)) collectFailureMessages(value, out);
    }
    for (const [key, value] of entries) {
      if (/code|status|state/i.test(key)) collectFailureMessages(value, out);
    }
  }
}

function pickVideoUrl(urls) {
  for (const url of urls) {
    if (isAllowed(url) && /\.mp4(\?|#|$)/i.test(url)) return cleanUrl(url);
  }
  for (const url of urls) {
    if (isHttpsUrl(url) && /\.mp4(\?|#|$)/i.test(url)) return cleanUrl(url);
  }
  return "";
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

function sb() {
  return { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` };
}

function safeJson(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

function isHttpsUrl(u) {
  return typeof u === "string" && /^https:\/\//i.test(u);
}

function isUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function host(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

function isAllowed(u) {
  if (!isUrl(u)) return false;
  return ALLOWED.has(host(u));
}

function cleanUrl(u) {
  return String(u || "").replace(/[)\],.]+$/g, "");
}

function collect(x, out) {
  if (!x) return;
  if (typeof x === "string") {
    const matches = x.match(/https?:\/\/[^"'\s\])]+/ig);
    if (matches) matches.forEach((u) => out.push(cleanUrl(u)));
    return;
  }
  if (Array.isArray(x)) {
    x.forEach((v) => collect(v, out));
    return;
  }
  if (typeof x === "object") {
    Object.values(x).forEach((v) => collect(v, out));
  }
}

function collectUrls(x) {
  const urls = [];
  collect(x, urls);
  return Array.from(new Set(urls));
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}
