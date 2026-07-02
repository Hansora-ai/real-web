// netlify/functions/image-tools-check.js
// Robust checker/refunder for Hansora Image Tools KIE jobs.
// Handles Nano Banana Pro image upscale and Topaz video upscale results.

const VERSION_TAG = "image-tools-check-robust-2026-05-15+multi-endpoint-jsonurl";

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const HISTORY_BUCKET = process.env.KIE_HISTORY_BUCKET || "generation-history";
const MAX_ARCHIVE_BYTES = Math.max(1, Number(process.env.KIE_HISTORY_MAX_MB || 200)) * 1024 * 1024;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (event.httpMethod === "POST") return await handlePost(event);
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Use GET or POST", version: VERSION_TAG });

    const qs = event.queryStringParameters || {};
    const ids = {
      uid: String(qs.uid || "").trim(),
      run_id: String(qs.run_id || qs.runId || "").trim(),
      taskId: String(qs.taskId || qs.task_id || qs.id || "").trim()
    };
    const debug = qs.debug === "1" || qs.debug === "true";

    const row = await findProcessingGeneration(ids);
    if (!row) return json(200, { ok: false, status: "ignored", reason: "not_processing", version: VERSION_TAG });

    ids.uid = ids.uid || row.user_id || "";
    ids.run_id = ids.run_id || row.meta?.run_id || "";
    ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || "";

    if (!ids.taskId) return json(200, { ok: false, status: "pending", error: "missing_task_id", version: VERSION_TAG });

    const inputUrls = collectKnownInputUrls(row);
    const state = await fetchKieState(ids.taskId, inputUrls, debug);

    if (state.done && state.urls.length) {
      const savedUrls = await markDone({ row, ids, urls: state.urls });
      return json(200, {
        ok: true,
        status: "done",
        state: "succeeded",
        result_url: savedUrls[0],
        image_url: savedUrls[0],
        video_url: savedUrls[0],
        urls: savedUrls,
        version: VERSION_TAG,
        ...(debug ? { debug: state.debug || {} } : {})
      });
    }

    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || "kie_failed" });
      return json(200, {
        ok: false,
        failed: true,
        status: "failed",
        error: state.error || "kie_failed",
        refunded: !!refund.refunded,
        refund_amount: refund.amount || 0,
        already_claimed: !!refund.already_claimed,
        version: VERSION_TAG,
        ...(debug ? { debug: state.debug || {} } : {})
      });
    }

    return json(200, { ok: false, status: "pending", version: VERSION_TAG, ...(debug ? { debug: state.debug || {} } : {}) });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error), version: VERSION_TAG });
  }
};

async function handlePost(event) {
  const qs = event.queryStringParameters || {};
  const body = safeJson(event.body);
  const bodyIds = extractIds(body);
  const ids = {
    uid: String(qs.uid || bodyIds.uid || "").trim(),
    run_id: String(qs.run_id || qs.runId || bodyIds.run_id || "").trim(),
    taskId: String(qs.taskId || qs.task_id || qs.id || bodyIds.taskId || "").trim()
  };

  const row = await findProcessingGeneration(ids);
  if (!row) return json(200, { ok: false, status: "ignored", reason: "not_processing", version: VERSION_TAG });

  ids.uid = ids.uid || row.user_id || "";
  ids.run_id = ids.run_id || row.meta?.run_id || "";
  ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || "";

  const urls = collectResultUrls(body, collectKnownInputUrls(row));
  if (urls.length) {
    const savedUrls = await markDone({ row, ids, urls });
    return json(200, { ok: true, status: "done", result_url: savedUrls[0], image_url: savedUrls[0], video_url: savedUrls[0], urls: savedUrls, version: VERSION_TAG });
  }

  const status = normalizeStatus(body);
  if (status === "failed") {
    const refund = await failAndRefundOnce({ row, ids, reason: failureReason(body) });
    return json(200, { ok: false, failed: true, status: "failed", error: failureReason(body), refunded: !!refund.refunded, refund_amount: refund.amount || 0, version: VERSION_TAG });
  }

  return json(200, { ok: false, status: "pending", version: VERSION_TAG });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: statusCode === 204 ? "" : JSON.stringify(body) };
}
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function messageOf(error) { return error && error.message ? error.message : String(error); }

function extractIds(body) {
  const meta = body?.meta || body?.metadata || body?.data?.meta || body?.data?.metadata || body?.result?.meta || {};
  return {
    uid: String(body?.uid || body?.user_id || body?.data?.uid || meta.uid || "").trim(),
    run_id: String(body?.run_id || body?.runId || body?.data?.run_id || body?.data?.runId || meta.run_id || meta.runId || "").trim(),
    taskId: String(body?.taskId || body?.task_id || body?.data?.taskId || body?.data?.task_id || body?.result?.taskId || body?.id || "").trim()
  };
}

async function findProcessingGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const select = "select=id,user_id,provider,kind,result_url,meta,created_at";
  const queries = [];
  if (ids.uid && ids.run_id) {
    queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&kind=eq.image_tools&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
    queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  }
  if (ids.taskId) {
    queries.push(`?kind=eq.image_tools&meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?kind=eq.image_tools&meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }

  for (const query of queries) {
    const res = await fetch(UG_URL + query, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const row = Array.isArray(arr) ? arr[0] : null;
    if (!row) continue;
    if (row.result_url) return row;
    const status = String(row.meta?.status || "").toLowerCase();
    if (status === "processing" || status === "pending" || !status || status === "submitted") return row;
  }
  return null;
}

async function fetchKieState(taskId, excludeUrls = [], debug = false) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };

  const attempts = [
    { method: "GET", path: `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}` },
    { method: "GET", path: `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}` },
    { method: "POST", path: `/api/v1/jobs/getTask`, body: { taskId } },
    { method: "GET", path: `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}` },
    { method: "GET", path: `/api/v1/jobs/getResult?taskId=${encodeURIComponent(taskId)}` },
    { method: "GET", path: `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}` },
    { method: "GET", path: `/api/v1/jobs/getTaskDetails?taskId=${encodeURIComponent(taskId)}` }
  ];

  const debugTries = [];
  let sawFinalFailed = false;
  let failReason = "";

  for (const attempt of attempts) {
    const result = await fetchJsonAny(attempt.method, KIE_BASE + attempt.path, attempt.body);
    debugTries.push({
      method: attempt.method,
      path: attempt.path,
      status: result.status,
      ok: result.ok,
      state: normalizeStatus(result.data),
      kie_state: result.data?.data?.state || result.data?.state || result.data?.data?.status || result.data?.status || "",
      failMsg: result.data?.data?.failMsg || result.data?.failMsg || "",
      urls: collectRawUrls(result.data).slice(0, 5)
    });

    const urls = collectResultUrls(result.data, excludeUrls);
    if (urls.length) return { done: true, urls, debug: debug ? { attempts: debugTries } : undefined };

    const jsonUrl = pickJsonUrl(result.data);
    if (jsonUrl) {
      const nested = await fetchNestedResultJson(jsonUrl, excludeUrls);
      debugTries[debugTries.length - 1].jsonUrl = jsonUrl;
      debugTries[debugTries.length - 1].nestedUrls = nested.urls.slice(0, 5);
      if (nested.urls.length) return { done: true, urls: nested.urls, debug: debug ? { attempts: debugTries } : undefined };
    }

    const status = normalizeStatus(result.data);
    if (status === "failed" && isFinalFailurePayload(result.data)) {
      sawFinalFailed = true;
      failReason = failReason || failureReason(result.data);
    }
  }

  if (sawFinalFailed) return { failed: true, error: failReason || "kie_failed", debug: debug ? { attempts: debugTries } : undefined };
  return { pending: true, debug: debug ? { attempts: debugTries } : undefined };
}

async function fetchJsonAny(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${KIE_KEY}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data, text };
  } catch (error) {
    return { ok: false, status: 0, data: { error: messageOf(error) }, text: "" };
  }
}

async function fetchNestedResultJson(jsonUrl, excludeUrls) {
  try {
    const res = await fetch(jsonUrl);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { urls: collectResultUrls(data, excludeUrls), data };
  } catch {
    return { urls: [] };
  }
}

async function markDone({ row, ids, urls }) {
  if (!UG_URL || !SERVICE_KEY) return urls;
  const archive = await archiveResultUrls({ row, urls });
  const savedUrls = archive.urls.length ? archive.urls : urls;
  const meta = {
    ...(row.meta && typeof row.meta === "object" ? row.meta : {}),
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || "",
    status: "done",
    result_urls: savedUrls,
    completed_at: new Date().toISOString(),
    original_result_url: urls[0],
    original_result_urls: urls,
    ...(archive.paths.length ? {
      storage_bucket: HISTORY_BUCKET,
      storage_path: archive.paths[0],
      storage_paths: archive.paths,
      archived_at: new Date().toISOString(),
      archive_errors: archive.errors
    } : {
      archive_errors: archive.errors.length ? archive.errors : ["archive_failed"]
    })
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: savedUrls[0], meta })
  });
  return savedUrls;
}

async function archiveResultUrls({ row, urls }) {
  const archivedUrls = [];
  const paths = [];
  const errors = [];
  for (let index = 0; index < urls.slice(0, 4).length; index += 1) {
    const sourceUrl = urls[index];
    const archive = await archiveResultUrl({ row, sourceUrl, index });
    archivedUrls.push(archive.ok ? archive.publicUrl : sourceUrl);
    if (archive.ok) paths.push(archive.path);
    else errors.push(archive.error || `archive_${index + 1}_failed`);
  }
  return { urls: archivedUrls, paths, errors };
}

async function archiveResultUrl({ row, sourceUrl, index }) {
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

    const contentType = normalizeArchiveContentType(sourceRes.headers.get("content-type"), sourceUrl, bytes);
    const extension = extensionForArchive(contentType, sourceUrl);
    const suffix = index > 0 ? `-${index + 1}` : "";
    const path = `${row.user_id}/${row.id}${suffix}.${extension}`;
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
    const uploadRes = await fetch(`${baseUrl}/storage/v1/object/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`, {
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
    return {
      ok: true,
      path,
      publicUrl: `${baseUrl}/storage/v1/object/public/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function normalizeArchiveContentType(value, url, bytes) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (/^(image|video)\//.test(type) && type !== "image/svg+xml") return type;
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.webm$/.test(clean)) return "video/webm";
  if (/\.(mov|qt)$/.test(clean)) return "video/quicktime";
  if (/\.m4v$/.test(clean)) return "video/mp4";
  if (/\.png$/.test(clean)) return "image/png";
  if (/\.(jpg|jpeg)$/.test(clean)) return "image/jpeg";
  if (/\.webp$/.test(clean)) return "image/webp";
  if (/\.gif$/.test(clean)) return "image/gif";
  const head = new Uint8Array(bytes || new ArrayBuffer(0)).slice(0, 16);
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  return "video/mp4";
}

function extensionForArchive(contentType, url) {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  if (match && /^(mp4|webm|mov|m4v|png|jpg|jpeg|webp|gif)$/.test(match[1])) {
    return match[1] === "jpeg" ? "jpg" : match[1];
  }
  if (contentType === "video/webm") return "webm";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "mp4";
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || 0);
  const failedMeta = {
    ...meta,
    run_id: ids.run_id || meta.run_id || "",
    task_id: ids.taskId || meta.task_id || meta.taskId || "",
    status: "failed",
    failed: true,
    error: reason,
    failed_at: new Date().toISOString()
  };

  if (!Number.isFinite(amount) || amount <= 0) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_skipped_reason: "missing_refund_amount" } });
    return { refunded: false, amount: 0, reason: "missing_refund_amount" };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...failedMeta, refund_claim: claim };
  const claimRes = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&result_url=is.null&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ result_url: null, meta: claimMeta })
  });
  const claimed = await claimRes.json().catch(() => []);
  if (!claimRes.ok || !Array.isArray(claimed) || !claimed.length) return { refunded: false, amount, already_claimed: true };

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

  await patchGeneration(row.id, { meta: { ...claimMeta, refunded: true, refunded_cost: amount, refunded_at: new Date().toISOString() } });
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
  const flag = value?.data?.successFlag ?? value?.successFlag ?? value?.result?.successFlag;
  if (flag === 1 || flag === "1") return "done";
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return "failed";
  const text = [];
  collectStatusText(value, text);
  const joined = text.join(" ").toLowerCase();
  if (/(success|succeeded|completed|complete|finish|finished|done)/.test(joined)) return "done";
  if (/(fail|failed|failure|errored|cancel|canceled|cancelled|rejected|moderation|blocked|sensitive|flagged)/.test(joined)) return "failed";
  return "pending";
}
function collectStatusText(value, out) {
  if (!value || out.length > 80) return;
  if (typeof value === "string") {
    if (/fail|error|success|complete|finish|done|pending|process|cancel|reject|blocked|moderation|sensitive|flag/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectStatusText(item, out); return; }
  if (typeof value === "object") {
    for (const key of ["status", "state", "message", "msg", "error", "reason", "description"]) if (value[key] != null) collectStatusText(value[key], out);
    for (const key of ["data", "result", "response", "task", "job"]) if (value[key]) collectStatusText(value[key], out);
  }
}
function isFinalFailurePayload(value) {
  const flag = value?.data?.successFlag ?? value?.successFlag ?? value?.result?.successFlag;
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return true;
  const explicit = String(value?.data?.status || value?.status || value?.result?.status || value?.data?.state || value?.state || "").toLowerCase();
  return /^(fail|failed|failure|error|errored|cancelled|canceled|rejected)$/.test(explicit);
}
function failureReason(value) {
  return String(value?.error || value?.message || value?.msg || value?.failMsg || value?.data?.error || value?.data?.message || value?.data?.msg || value?.data?.reason || value?.data?.failMsg || value?.data?.failCode || value?.result?.error || value?.result?.message || value?.result?.failMsg || "kie_failed");
}

function normalizeComparableUrl(url) { return String(url || "").replace(/[)"'\\\]}]+$/g, "").trim(); }
function isUrl(url) { return typeof url === "string" && /^https?:\/\//i.test(url); }
function isCallbackOrApiUrl(url) {
  const lower = String(url || "").toLowerCase();
  return lower.includes("callback") || lower.includes("/.netlify/functions/run-image-tools") || lower.includes("/.netlify/functions/image-tools-check") || lower.includes("/.netlify/functions/image-tools-kie-callback") || lower.includes("api.kie.ai/api/");
}
function isLikelyMediaUrl(url) {
  const lower = String(url || "").toLowerCase().split("?")[0].split("#")[0];
  return /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i.test(lower) || lower.includes("tempfile.redpandaai.co") || lower.includes("storage.googleapis.com") || lower.includes("s3.") || lower.includes("r2.cloudflarestorage.com");
}
function collectRawUrls(value) {
  const urls = [];
  const seen = new Set();
  function walk(x, depth = 0) {
    if (!x || depth > 8) return;
    if (typeof x === "string") {
      const matches = x.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach((u) => { const clean = normalizeComparableUrl(u); if (isUrl(clean) && !seen.has(clean)) { seen.add(clean); urls.push(clean); } });
      return;
    }
    if (Array.isArray(x)) { x.forEach((v) => walk(v, depth + 1)); return; }
    if (typeof x === "object") Object.values(x).forEach((v) => walk(v, depth + 1));
  }
  walk(value);
  return urls;
}
function collectKnownInputUrls(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const urls = [];
  const keys = ["input_url", "file_url", "image_url", "video_url", "source_url", "uploaded_url"];
  for (const key of keys) if (typeof meta[key] === "string") urls.push(normalizeComparableUrl(meta[key]));
  return urls.filter(Boolean);
}
function pickJsonUrl(value) {
  if (!value || typeof value !== "object") return "";
  const keys = ["jsonUrl", "jsonurl", "json_url", "resultJson", "result_json"];
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    for (const key of keys) if (isUrl(item[key])) return normalizeComparableUrl(item[key]);
    for (const child of Object.values(item)) if (child && typeof child === "object") stack.push(child);
  }
  return "";
}
function collectResultUrls(value, excludeUrls = []) {
  const urls = [];
  const seen = new Set();
  const excluded = new Set(excludeUrls.map(normalizeComparableUrl).filter(Boolean));
  const outputKeys = new Set([
    "video_url", "videoUrl", "image_url", "imageUrl", "result_url", "resultUrl", "result_urls", "resultUrls", "fullResultUrls", "full_result_urls",
    "resultJson", "result_json", "resultJSON",
    "resultImageUrl", "result_image_url", "url", "download_url", "downloadUrl", "media_url", "mediaUrl", "asset_url", "assetUrl", "file", "output", "outputs",
    "images", "image_urls", "imageUrls", "videos", "video_urls", "videoUrls", "urls", "files", "file_url", "fileUrl", "file_urls", "fileUrls", "generate_url", "generateUrl"
  ]);
  const containerKeys = new Set(["data", "result", "results", "response", "info", "task_result", "taskResult", "output", "outputs"]);
  const blockedKeys = /(^|_)(input|inputs|reference|references|source|first|last|tail|start|end|frame|frames|request|payload|params|parameters|meta|metadata|callback)(_|$)/i;

  function push(url, trusted = false) {
    if (!isUrl(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || excluded.has(clean) || seen.has(clean) || isCallbackOrApiUrl(clean)) return;
    if (!trusted && !isLikelyMediaUrl(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(x, depth = 0, trusted = false) {
    if (!x || depth > 8 || urls.length >= 8) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) { walk(parsed, depth + 1, trusted); return; }
      if (!trusted && !isLikelyMediaUrl(x)) return;
      const matches = x.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach((u) => push(u, trusted));
      return;
    }
    if (Array.isArray(x)) { for (const item of x) walk(item, depth + 1, trusted || depth === 0); return; }
    if (typeof x === "object") {
      for (const [rawKey, child] of Object.entries(x)) {
        const key = String(rawKey || "");
        const nextTrusted = trusted || outputKeys.has(key);
        if (!nextTrusted && !trusted && blockedKeys.test(key)) continue;
        if (nextTrusted || containerKeys.has(key)) walk(child, depth + 1, nextTrusted);
      }
    }
  }
  walk(value);
  return urls.slice(0, 8);
}
