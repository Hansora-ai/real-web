// netlify/functions/heygen-check-fixed.js
// Polls HeyGen jobs, saves only real video file URLs, and refunds once on failure.

const HEYGEN_API_ENV = pickEnv("HEYGEN_API_KEY", "HeyGen_api", "HEYGEN_API", "HeyGen_API");
const HEYGEN_API_KEY = HEYGEN_API_ENV.value;
const HEYGEN_BASE = (process.env.HEYGEN_BASE_URL || "https://api.heygen.com").replace(/\/+$/, "");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const HISTORY_BUCKET = process.env.HEYGEN_HISTORY_BUCKET || "generation-history";
const MAX_ARCHIVE_BYTES = Math.max(1, Number(process.env.HEYGEN_HISTORY_MAX_MB || 200)) * 1024 * 1024;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { ok: false, error: "Use GET or POST" });

    const qs = event.queryStringParameters || {};
    const body = parseBody(event);
    const idsFromBody = extractIds(body);
    const ids = {
      uid: String(qs.uid || idsFromBody.uid || "").trim(),
      run_id: String(qs.run_id || idsFromBody.run_id || "").trim(),
      taskId: String(qs.taskId || qs.task_id || idsFromBody.taskId || "").trim()
    };

    const row = await findGeneration(ids);
    if (row) {
      ids.uid = ids.uid || row.user_id || "";
      ids.run_id = ids.run_id || row.meta?.run_id || "";
      ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || row.meta?.video_id || "";
    }

    if (event.httpMethod === "POST" && row) {
      const callbackStatus = normalizeStatus(body);
      const callbackUrls = collectResultUrls(body);
      if (callbackStatus === "failed") {
        const refund = await failAndRefundOnce({ row, ids, reason: failureReason(body) });
        return json(200, { ok: false, failed: true, status: "failed", refunded: !!refund.refunded, refund_amount: refund.amount || 0, error: failureReason(body) });
      }
      if (callbackUrls.length) {
        const savedUrl = await markDone({ row, ids, urls: callbackUrls, raw: body });
        return json(200, { ok: true, status: "done", result_url: savedUrl, video_url: savedUrl, urls: [savedUrl] });
      }
    }

    if (!ids.taskId) return json(200, { ok: false, status: row ? "pending" : "ignored", reason: "missing_task_id" });

    const preferredApi = row?.meta?.provider_api || row?.meta?.api_version || "v2";
    const state = await fetchHeyGenStateAny(ids.taskId, preferredApi);

    if (state.failed) {
      if (row) {
        const refund = await failAndRefundOnce({ row, ids, reason: state.error || "heygen_failed" });
        return json(200, { ok: false, failed: true, status: "failed", error: state.error || "heygen_failed", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
      }
      return json(200, { ok: false, failed: true, status: "failed", error: state.error || "heygen_failed" });
    }

    if (state.done && state.urls.length) {
      const savedUrl = row ? await markDone({ row, ids, urls: state.urls, raw: state.raw }) : state.urls[0];
      return json(200, { ok: true, status: "done", result_url: savedUrl, video_url: savedUrl, urls: [savedUrl] });
    }

    return json(200, { ok: false, status: "pending", error: state.error || "" });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error) });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) };
}
function pickEnv(...names) {
  for (const name of names) {
    const value = cleanApiKey(process.env[name]);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}
function cleanApiKey(value) {
  let text = String(value || "").trim();
  text = text.replace(/^['"]|['"]$/g, "").trim();
  text = text.replace(/^bearer\s+/i, "").trim();
  text = text.replace(/\s+/g, "");
  return text;
}
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function parseBody(event) {
  if (event.httpMethod !== "POST") return {};
  let raw = event.body || "";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  const parsed = safeJson(raw);
  if (parsed && Object.keys(parsed).length) return parsed;
  return { raw };
}

function extractIds(body) {
  const meta = body?.meta || body?.metadata || body?.data?.meta || body?.data?.metadata || body?.result?.meta || {};
  return {
    uid: String(body?.uid || body?.user_id || body?.data?.uid || meta.uid || "").trim(),
    run_id: String(body?.run_id || body?.callback_id || body?.data?.run_id || body?.data?.callback_id || meta.run_id || meta.callback_id || "").trim(),
    taskId: String(body?.taskId || body?.task_id || body?.video_id || body?.id || body?.data?.taskId || body?.data?.task_id || body?.data?.video_id || body?.data?.id || body?.result?.video_id || body?.result?.id || "").trim()
  };
}

async function findGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const select = "select=id,user_id,provider,kind,result_url,meta,created_at";
  const queries = [];
  if (ids.uid && ids.run_id) queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  if (ids.run_id) queries.push(`?meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?meta->>video_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }
  for (const query of queries) {
    const res = await fetch(UG_URL + query, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const row = Array.isArray(arr) ? arr[0] : null;
    if (row) return row;
  }
  return null;
}

async function fetchHeyGenStateAny(videoId, preferredApi) {
  const first = String(preferredApi || "v2").toLowerCase() === "v3" ? "v3" : "v2";
  const second = first === "v2" ? "v3" : "v2";
  const a = await fetchHeyGenState(videoId, first);
  if (a.done || a.failed) return a;
  const b = await fetchHeyGenState(videoId, second);
  if (b.done || b.failed) return b;
  return { pending: true, error: a.error || b.error || "" };
}

async function fetchHeyGenState(videoId, apiVersion) {
  if (!HEYGEN_API_KEY) return { pending: true, error: "missing_heygen_api_key" };
  const version = String(apiVersion || "v2").toLowerCase() === "v3" ? "v3" : "v2";
  const paths = version === "v2"
    ? [`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, `/v2/videos/${encodeURIComponent(videoId)}`]
    : [`/v3/videos/${encodeURIComponent(videoId)}`];

  let lastError = "";
  for (const path of paths) {
    try {
      const res = await fetch(`${HEYGEN_BASE}${path}`, { headers: { "x-api-key": HEYGEN_API_KEY, Accept: "application/json" } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text || "{}"); } catch { data = { raw: text }; }
      if (!res.ok) {
        lastError = failureReason(data) || `heygen_${res.status}`;
        continue;
      }
      const status = normalizeStatus(data);
      const urls = collectResultUrls(data);
      if (status === "failed") return { failed: true, error: failureReason(data), raw: data };
      if ((status === "done" || urls.length) && urls.length) return { done: true, urls, raw: data };
    } catch (error) {
      lastError = messageOf(error);
    }
  }
  return { pending: true, error: lastError };
}

function normalizeStatus(value) {
  const texts = [];
  collectStatusText(value, texts);
  const s = texts.join(" ").toLowerCase();
  if (/\b(completed|complete|success|succeeded|done|ready)\b/.test(s)) return "done";
  if (/\b(failed|fail|error|errored|cancelled|canceled|rejected|blocked)\b/.test(s)) return "failed";
  return "pending";
}
function collectStatusText(value, out) {
  if (!value || out.length > 100) return;
  if (typeof value === "string") {
    if (/fail|error|success|complete|finish|done|ready|pending|process|cancel|reject|blocked/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => collectStatusText(item, out)); return; }
  if (typeof value === "object") {
    for (const key of ["status", "state", "message", "error", "reason", "description", "failure_message"]) {
      if (value[key] != null) collectStatusText(value[key], out);
    }
    for (const key of ["data", "result", "response", "video"]) {
      if (value[key]) collectStatusText(value[key], out);
    }
  }
}
function failureReason(value) {
  return String(value?.error || value?.message || value?.failure_message || value?.data?.error || value?.data?.message || value?.data?.failure_message || value?.result?.error || value?.result?.message || "heygen_failed");
}

function collectResultUrls(value) {
  const urls = [];
  const seen = new Set();
  const priorityKeys = new Set(["video_url", "url", "download_url", "output_url", "file_url", "result_url"]);
  function push(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\]}]+$/g, "").trim();
    if (isHeyGenPageUrl(clean)) return;
    if (!/\.(mp4|webm|mov)(?:[?#].*)?$/i.test(clean) && !/files\.heygen\.com|resource2\.heygen\.ai/i.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(node, trusted = false, depth = 0) {
    if (!node || depth > 10) return;
    if (typeof node === "string") {
      if (trusted) push(node);
      const matches = node.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach(push);
      return;
    }
    if (Array.isArray(node)) { node.forEach((item) => walk(item, trusted, depth + 1)); return; }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) walk(child, trusted || priorityKeys.has(String(key || "")), depth + 1);
    }
  }
  walk(value);
  return urls.slice(0, 4);
}
function isHeyGenPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.toLowerCase() === "app.heygen.com" && /^\/videos\//i.test(url.pathname);
  } catch {
    return false;
  }
}

async function markDone({ row, ids, urls, raw }) {
  const originalResultUrl = urls[0];
  const existingMeta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const alreadyArchived = !!existingMeta.storage_path &&
    typeof row.result_url === "string" &&
    row.result_url.includes(`/storage/v1/object/public/${HISTORY_BUCKET}/`);
  const archive = alreadyArchived
    ? { ok: true, path: existingMeta.storage_path, publicUrl: row.result_url }
    : await archiveHeyGenVideo({ row, sourceUrl: originalResultUrl });
  const meta = {
    ...existingMeta,
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.video_id || "",
    video_id: ids.taskId || row.meta?.video_id || row.meta?.task_id || "",
    status: "done",
    completed_at: new Date().toISOString(),
    heygen_status_response: raw || row.meta?.heygen_status_response || null,
    original_result_url: originalResultUrl,
    ...(archive.ok ? {
      storage_bucket: HISTORY_BUCKET,
      storage_path: archive.path,
      archived_at: existingMeta.archived_at || new Date().toISOString(),
      archive_error: null
    } : {
      archive_error: archive.error || "archive_failed"
    })
  };
  const savedUrl = archive.ok ? archive.publicUrl : originalResultUrl;
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: savedUrl, meta })
  });
  return savedUrl;
}

async function archiveHeyGenVideo({ row, sourceUrl }) {
  if (!SUPABASE_URL || !SERVICE_KEY || !row?.id || !row?.user_id || !sourceUrl) {
    return { ok: false, error: "missing_archive_config" };
  }
  try {
    const sourceRes = await fetch(sourceUrl);
    if (!sourceRes.ok) return { ok: false, error: `source_download_${sourceRes.status}` };

    const contentLength = Number(sourceRes.headers.get("content-length") || 0);
    if (contentLength > MAX_ARCHIVE_BYTES) return { ok: false, error: "archive_file_too_large" };

    const bytes = await sourceRes.arrayBuffer();
    if (!bytes.byteLength) return { ok: false, error: "archive_empty_file" };
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return { ok: false, error: "archive_file_too_large" };

    const contentType = normalizeVideoContentType(sourceRes.headers.get("content-type"), sourceUrl);
    const extension = extensionForVideo(contentType, sourceUrl);
    const path = `${row.user_id}/${row.id}.${extension}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(HISTORY_BUCKET)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...sb(),
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: Buffer.from(bytes)
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      return { ok: false, error: `archive_upload_${uploadRes.status}${text ? `:${text.slice(0, 180)}` : ""}` };
    }

    const publicPath = path.split("/").map(encodeURIComponent).join("/");
    return {
      ok: true,
      path,
      publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(HISTORY_BUCKET)}/${publicPath}`
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function normalizeVideoContentType(value, url) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (type === "video/mp4" || type === "video/webm" || type === "video/quicktime") return type;
  if (/\.webm(?:[?#]|$)/i.test(String(url || ""))) return "video/webm";
  if (/\.mov(?:[?#]|$)/i.test(String(url || ""))) return "video/quicktime";
  return "video/mp4";
}

function extensionForVideo(contentType, url) {
  if (contentType === "video/webm" || /\.webm(?:[?#]|$)/i.test(String(url || ""))) return "webm";
  if (contentType === "video/quicktime" || /\.mov(?:[?#]|$)/i.test(String(url || ""))) return "mov";
  return "mp4";
}

async function patchGeneration(id, patch) {
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
  return res.ok;
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || meta.cost || 0);
  const failedMeta = {
    ...meta,
    run_id: ids.run_id || meta.run_id || "",
    task_id: ids.taskId || meta.task_id || meta.video_id || "",
    video_id: ids.taskId || meta.video_id || meta.task_id || "",
    status: "failed",
    failed: true,
    error: reason,
    failed_at: meta.failed_at || new Date().toISOString()
  };

  if (String(meta.refunded || "").toLowerCase() === "true") {
    await patchGeneration(row.id, { result_url: null, meta: failedMeta });
    return { refunded: false, already_refunded: true, amount };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await patchGeneration(row.id, { result_url: null, meta: { ...failedMeta, refund_skipped_reason: "missing_refund_amount" } });
    return { refunded: false, amount: 0 };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...failedMeta, refund_claim: claim };
  const claimUrl = `${UG_URL}?id=eq.${encodeURIComponent(row.id)}&result_url=is.null&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`;
  const claimRes = await fetch(claimUrl, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ result_url: null, meta: claimMeta })
  });
  const claimedRows = await claimRes.json().catch(() => []);
  if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) {
    return { refunded: false, amount, already_claimed: true };
  }

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
    await patchGeneration(row.id, { meta: { ...claimMeta, refund_error: "profile_refund_failed" } });
    return { refunded: false, amount, error: "profile_refund_failed" };
  }
  await patchGeneration(row.id, {
    result_url: null,
    meta: {
      ...claimMeta,
      refunded: "true",
      refunded_cost: amount,
      refunded_at: new Date().toISOString()
    }
  });
  return { refunded: true, amount, credits: nextCredits };
}
