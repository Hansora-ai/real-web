// netlify/functions/heygen-check-fixed.js
// Polls HeyGen jobs, saves only real video file URLs, and refunds once on failure.

const HEYGEN_API_ENV = pickEnv("HEYGEN_API_KEY", "HeyGen_api", "HEYGEN_API", "HeyGen_API");
const STUCK_SUBMIT_MS = 30 * 60 * 1000;
const RESEND_AFTER_MS = 90 * 1000;
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

    let row = await findGeneration(ids);
    if (row) {
      ids.uid = ids.uid || row.user_id || "";
      ids.run_id = ids.run_id || row.meta?.run_id || "";
      ids.taskId = row.meta?.task_id || row.meta?.taskId || row.meta?.video_id || "";
    }

    if (row?.meta?.status === "failed") {
      return json(200, { ok: false, failed: true, status: "failed", error: row.meta.error || "heygen_failed", refunded: !!row.meta.refunded });
    }

    // Avatar IV is sent in one step. If HeyGen answered too slowly (or the step broke off) before returning a
    // video id, nothing was charged yet. The owner's poll sends it again below with the same Idempotency-Key,
    // so HeyGen returns the video it is already making rather than a new one; that run is then charged and
    // finished as usual. Only if no video id comes back within 30 minutes is it closed as failed, uncharged.
    const stuckAvatarIV = !ids.taskId && row && row.meta?.model !== "avatar_iii" && !row.result_url
      && String(row.meta?.status || "") === "processing";
    if (stuckAvatarIV) {
      const age = Date.now() - Date.parse(row.created_at || "");
      const charged = row.meta?.charged === true || row.meta?.charged === "true";
      if (!charged && age > STUCK_SUBMIT_MS) {
        const error = "This avatar video could not start. Nothing was charged. Please try again.";
        await patchGeneration(row.id, { meta: { ...row.meta, status: "failed", failed: true, error, error_summary: "heygen_not_started", failed_at: new Date().toISOString() } });
        return json(200, { ok: false, failed: true, status: "failed", error, refunded: false, charged: false });
      }
    }

    if (!ids.taskId && (row?.meta?.model === "avatar_iii" || (stuckAvatarIV && Date.now() - Date.parse(row.created_at || "") > RESEND_AFTER_MS))) {
      // Photo processing is asynchronous. Only the authenticated owner may
      // resume a paid submission; the submitter reuses persisted inputs and
      // serializes repeated polls. Webhooks never initiate new generations.
      const authorization = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "authorization")?.[1];
      if (event.httpMethod === "GET" && authorization) {
        const { handler: submit } = require("./run-heygen-avatar.js");
        const resumed = await submit({ httpMethod: "POST", headers: { authorization }, body: JSON.stringify({ uid: row.user_id, run_id: row.meta.run_id }) });
        const result = safeJson(resumed.body);
        if (!result.submitted) {
          // Auth/temporary infrastructure errors must not fail the stored job.
          const current = await findGeneration(ids);
          if (current?.meta?.status === "failed") return json(200, { ok: false, failed: true, status: "failed", error: current.meta.error });
          return json(200, { ok: false, status: "pending", error: result.error });
        }
        ids.taskId = result.taskId || result.video_id || "";
        if (ids.taskId) row = await findGeneration(ids) || row;
      }
    }

    if (!ids.taskId) return json(200, { ok: false, status: row ? "pending" : "ignored", reason: "missing_task_id" });

    // Treat callbacks as signals and read the authoritative v3 status. This
    // also supports videos created before migration without legacy fallback.
    const state = await fetchHeyGenState(ids.taskId);

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
  body = body?.event_data || body;
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

// https://developers.heygen.com/reference/get-video
async function fetchHeyGenState(videoId) {
  if (!HEYGEN_API_KEY) return { pending: true, error: "missing_heygen_api_key" };
  try {
    const res = await fetch(`${HEYGEN_BASE}/v3/videos/${encodeURIComponent(videoId)}`, {
      headers: { "x-api-key": HEYGEN_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    // HTTP errors (including 429/5xx) are not terminal render failures.
    if (!res.ok) return { pending: true, error: failureReason(data) || `heygen_${res.status}` };
    const status = normalizeStatus(data);
    if (status === "failed") return { failed: true, error: failureReason(data), raw: data };
    const urls = collectResultUrls(data);
    if (status === "done" && urls.length) return { done: true, urls, raw: data };
    return { pending: true };
  } catch (error) {
    return { pending: true, error: messageOf(error) };
  }
}

function normalizeStatus(value) {
  const state = String(value?.data?.status || value?.status || "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "done", "ready"].includes(state)) return "done";
  if (["failed", "error", "cancelled", "canceled"].includes(state)) return "failed";
  return "pending";
}

function failureReason(value) {
  const resource = value?.data || value || {};
  const error = resource.error || value?.error;
  return String(resource.failure_message || error?.message || (typeof error === "string" ? error : "") || resource.message || resource.failure_code || error?.code || "heygen_failed");
}

function collectResultUrls(value) {
  const candidates = [];
  const seen = new Map();
  const priorityKeys = new Map([
    ["video_url", 100],
    ["download_url", 90],
    ["output_url", 80],
    ["file_url", 70],
    ["result_url", 60],
    ["url", 10]
  ]);
  function push(url, priority = 0) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = url.replace(/[)"'\]}]+$/g, "").trim();
    if (isHeyGenPageUrl(clean)) return;
    if (priority < 60 && !/\.(mp4|webm|mov)(?:[?#].*)?$/i.test(clean) && !/files\.heygen\.com|resource2\.heygen\.ai/i.test(clean)) return;
    const existing = seen.get(clean);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      return;
    }
    const candidate = { url: clean, priority, order: candidates.length };
    seen.set(clean, candidate);
    candidates.push(candidate);
  }
  function walk(node, priority = 0, depth = 0) {
    if (!node || depth > 10) return;
    if (typeof node === "string") {
      if (priority > 0) push(node, priority);
      const matches = node.match(/https?:\/\/[^\s"'<>]+/gi);
      if (matches) matches.forEach((url) => push(url, priority));
      return;
    }
    if (Array.isArray(node)) { node.forEach((item) => walk(item, priority, depth + 1)); return; }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const keyPriority = priorityKeys.get(String(key || "").toLowerCase()) || 0;
        walk(child, Math.max(priority, keyPriority), depth + 1);
      }
    }
  }
  walk(value);
  return candidates
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .map((candidate) => candidate.url);
}
function isHeyGenPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.toLowerCase() === "app.heygen.com" && /^\/videos?\//i.test(url.pathname);
  } catch {
    return false;
  }
}

async function markDone({ row, ids, urls, raw }) {
  const existingMeta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const alreadyArchived = existingMeta.archive_validated_video === true &&
    !!existingMeta.storage_path &&
    typeof row.result_url === "string" &&
    row.result_url.includes(`/storage/v1/object/public/${HISTORY_BUCKET}/`);
  let originalResultUrl = existingMeta.original_result_url || "";
  let archive = alreadyArchived
    ? { ok: true, path: existingMeta.storage_path, publicUrl: row.result_url }
    : null;

  if (!archive) {
    const failures = [];
    for (const sourceUrl of urls) {
      const candidate = await archiveHeyGenVideo({ row, sourceUrl });
      if (candidate.ok) {
        archive = candidate;
        originalResultUrl = sourceUrl;
        break;
      }
      failures.push(candidate.error || "unknown_candidate_error");
    }
    if (!archive) {
      throw new Error(`no_valid_heygen_video:${failures.slice(0, 6).join("|") || "no_candidate_urls"}`);
    }
  }

  const meta = {
    ...existingMeta,
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.video_id || "",
    video_id: ids.taskId || row.meta?.video_id || row.meta?.task_id || "",
    status: "done",
    completed_at: new Date().toISOString(),
    heygen_status_response: raw || row.meta?.heygen_status_response || null,
    original_result_url: originalResultUrl,
    storage_bucket: HISTORY_BUCKET,
    storage_path: archive.path,
    archived_at: existingMeta.archived_at || new Date().toISOString(),
    archive_validated_video: true,
    archive_error: null
  };
  const savedUrl = archive.publicUrl;
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

    const detected = detectVideoFile(bytes);
    if (!detected.ok) {
      const reportedType = String(sourceRes.headers.get("content-type") || "unknown").split(";")[0];
      return { ok: false, error: `${detected.error}:reported_${reportedType}` };
    }

    const contentType = detected.contentType;
    const extension = detected.extension;
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

function detectVideoFile(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 12) return { ok: false, error: "source_not_video_too_small" };

  const firstSix = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
  if (firstSix === "GIF87a" || firstSix === "GIF89a") {
    return { ok: false, error: "source_not_video_gif" };
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { ok: true, contentType: "video/webm", extension: "webm" };
  }

  const firstBoxType = Buffer.from(bytes.subarray(4, 8)).toString("ascii");
  if (firstBoxType === "ftyp") {
    const majorBrand = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
    if (majorBrand === "qt  ") {
      return { ok: true, contentType: "video/quicktime", extension: "mov" };
    }
    return { ok: true, contentType: "video/mp4", extension: "mp4" };
  }

  return { ok: false, error: "source_not_supported_video" };
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
  const charged = String(meta.charged || "").toLowerCase() === "true";
  const amount = charged ? Number(meta.refund_amount || meta.charged_cost || meta.cost || 0) : 0;
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
