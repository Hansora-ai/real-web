// netlify/functions/audio-check.js
// Checker/refunder for Hansora audio jobs: ElevenLabs market jobs + Suno music jobs.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const HISTORY_BUCKET = process.env.KIE_HISTORY_BUCKET || "generation-history";
const MAX_ARCHIVE_BYTES = Math.max(1, Number(process.env.KIE_HISTORY_MAX_MB || 200)) * 1024 * 1024;

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

    const audioKind = String(row.meta?.audio_kind || row.meta?.kind || "").toLowerCase();
    if (!ids.taskId) {
      if (isKieAudioStale(row, audioKind)) {
        const refund = await failAndRefundOnce({ row, ids, reason: "missing_task_id_timeout" });
        return json(200, { ok: false, failed: true, status: "failed", error: "missing_task_id_timeout", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
      }
      return json(200, { ok: false, status: "pending", error: "missing_task_id" });
    }

    if (audioKind && audioKind !== "music") {
      const state = readElevenState(row);
      if (state.failed) {
        return json(200, { ok: false, failed: true, status: "failed", error: state.error || "elevenlabs_failed", refunded: !!row.meta?.refunded, refund_amount: Number(row.meta?.refunded_cost || 0) });
      }
      if (state.done && state.audioUrls.length) {
        return json(200, { ok: true, status: "done", result_url: state.audioUrls[0], audio_url: state.audioUrls[0], audio_urls: state.audioUrls, image_urls: [] });
      }
      if (isElevenStale(row)) {
        const refund = await failAndRefundOnce({ row, ids, reason: "elevenlabs_timeout" });
        return json(200, { ok: false, failed: true, status: "failed", error: "elevenlabs_timeout", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
      }
      return json(200, { ok: false, status: "pending" });
    }
    const inputUrls = collectKnownInputUrls(row);
    const state = audioKind === "music" ? await fetchSunoState(ids.taskId, inputUrls) : await fetchMarketState(ids.taskId, inputUrls);

    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || "kie_failed" });
      return json(200, { ok: false, failed: true, status: "failed", error: state.error || "kie_failed", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
    }

    if (state.done && state.audioUrls.length) {
      const savedState = await markDone({ row, ids, state });
      return json(200, { ok: true, status: "done", result_url: savedState.audioUrls[0], audio_url: savedState.audioUrls[0], audio_urls: savedState.audioUrls, image_urls: savedState.imageUrls || [] });
    }

    if (isKieAudioStale(row, audioKind)) {
      const refund = await failAndRefundOnce({ row, ids, reason: "audio_provider_timeout" });
      return json(200, { ok: false, failed: true, status: "failed", error: "audio_provider_timeout", refunded: !!refund.refunded, refund_amount: refund.amount || 0 });
    }

    return json(200, { ok: false, status: "pending" });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error) });
  }
};

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,OPTIONS" }; }
function json(statusCode, body) { return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) }; }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function safeJson(raw) { if (!raw) return {}; try { return JSON.parse(raw); } catch { return {}; } }
function messageOf(error) { return error && error.message ? error.message : String(error); }

function readElevenState(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  if (meta.failed === true || meta.status === "failed") return { failed: true, error: meta.error || "elevenlabs_failed" };
  const audioUrls = [];
  if (row?.result_url) audioUrls.push(row.result_url);
  if (meta.audio_url) audioUrls.push(meta.audio_url);
  if (Array.isArray(meta.audio_urls)) audioUrls.push(...meta.audio_urls);
  const cleanUrls = [...new Set(audioUrls.map(normalizeComparableUrl).filter((url) => /^https?:\/\//i.test(url)))];
  if ((meta.status === "ready" || meta.status === "done" || meta.status === "complete") && cleanUrls.length) {
    return { done: true, audioUrls: cleanUrls };
  }
  return { pending: true, audioUrls: cleanUrls };
}

function isElevenStale(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const rawTime = meta.worker_started_at || meta.submitted_at || row?.created_at || "";
  const started = Date.parse(rawTime);
  if (!Number.isFinite(started)) return false;
  const maxPendingMs = Number(process.env.ELEVENLABS_AUDIO_TIMEOUT_MS || 30 * 60 * 1000);
  return Date.now() - started > maxPendingMs;
}

function isKieAudioStale(row, audioKind) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const rawTime = meta.worker_started_at || meta.submitted_at || row?.created_at || "";
  const started = Date.parse(rawTime);
  if (!Number.isFinite(started)) return false;
  const defaultTimeout = audioKind === "music" ? 90 * 60 * 1000 : 60 * 60 * 1000;
  const maxPendingMs = Number(process.env.KIE_AUDIO_TIMEOUT_MS || defaultTimeout);
  return Date.now() - started > maxPendingMs;
}

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

async function fetchMarketState(taskId, excludeUrls) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };
  const paths = [
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/recordInfo?task_id=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`
  ];
  return await fetchFirstFinished(paths, excludeUrls);
}

async function fetchSunoState(taskId, excludeUrls) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };
  const paths = [
    `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/generate/record-info?task_id=${encodeURIComponent(taskId)}`
  ];
  let terminalFailure = "";
  for (const path of paths) {
    try {
      const res = await fetch(KIE_BASE + path, { headers: { Accept: "application/json", Authorization: `Bearer ${KIE_KEY}` } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      const status = normalizeSunoStatus(data);
      if (status === "success") {
        const audioUrls = collectSunoFinalAudioUrls(data, excludeUrls);
        const imageUrls = collectImageUrls(data, excludeUrls);
        if (audioUrls.length) return { done: true, audioUrls, imageUrls, raw: data, suno_complete: true };
        return { pending: true };
      }

      if (status === "failed") {
        terminalFailure = terminalFailure || failureReason(data);
      }
    } catch (error) {
      console.warn("[audio-check] suno poll failed:", messageOf(error));
    }
  }
  if (terminalFailure) return { failed: true, error: terminalFailure };
  return { pending: true };
}

async function fetchFirstFinished(paths, excludeUrls = []) {
  let terminalFailure = "";
  for (const path of paths) {
    try {
      const res = await fetch(KIE_BASE + path, { headers: { Accept: "application/json", Authorization: `Bearer ${KIE_KEY}` } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      const audioUrls = collectAudioUrls(data, excludeUrls);
      const imageUrls = collectImageUrls(data, excludeUrls);
      if (audioUrls.length) return { done: true, audioUrls, imageUrls, raw: data };

      const status = normalizeStatus(data);
      if (status === "failed" && isFinalFailure(data, res.status)) {
        terminalFailure = terminalFailure || failureReason(data);
      }
    } catch (error) {
      // A polling/network error is not a final generation failure.
      console.warn("[audio-check] poll failed:", messageOf(error));
    }
  }
  if (terminalFailure) return { failed: true, error: terminalFailure };
  return { pending: true };
}

async function markDone({ row, ids, state }) {
  const audioArchive = await archiveResultUrls({ row, urls: state.audioUrls, prefix: "audio" });
  const imageArchive = await archiveResultUrls({ row, urls: state.imageUrls || [], prefix: "image" });
  const savedAudioUrls = audioArchive.urls.length ? audioArchive.urls : state.audioUrls;
  const savedImageUrls = imageArchive.urls.length ? imageArchive.urls : state.imageUrls || [];
  const archiveErrors = [...audioArchive.errors, ...imageArchive.errors];
  const meta = {
    ...(row.meta && typeof row.meta === "object" ? row.meta : {}),
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || "",
    status: "ready",
    failed: false,
    error: null,
    audio_url: savedAudioUrls[0],
    audio_urls: savedAudioUrls,
    image_urls: savedImageUrls,
    original_audio_url: state.audioUrls[0],
    original_audio_urls: state.audioUrls,
    original_image_urls: state.imageUrls || [],
    suno_complete: !!state.suno_complete,
    completed_at: new Date().toISOString(),
    ...(audioArchive.paths.length || imageArchive.paths.length ? {
      storage_bucket: HISTORY_BUCKET,
      storage_path: audioArchive.paths[0] || imageArchive.paths[0],
      storage_paths: audioArchive.paths,
      image_storage_paths: imageArchive.paths,
      archived_at: new Date().toISOString(),
      archive_errors: archiveErrors
    } : {
      archive_errors: archiveErrors.length ? archiveErrors : ["archive_failed"]
    })
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: savedAudioUrls[0], meta })
  });
  return { ...state, audioUrls: savedAudioUrls, imageUrls: savedImageUrls };
}

async function archiveResultUrls({ row, urls, prefix }) {
  const archivedUrls = [];
  const paths = [];
  const errors = [];
  for (let index = 0; index < urls.slice(0, 4).length; index += 1) {
    const sourceUrl = urls[index];
    const archive = await archiveResultUrl({ row, sourceUrl, index, prefix });
    archivedUrls.push(archive.ok ? archive.publicUrl : sourceUrl);
    if (archive.ok) paths.push(archive.path);
    else errors.push(archive.error || `${prefix || "media"}_${index + 1}_archive_failed`);
  }
  return { urls: archivedUrls, paths, errors };
}

async function archiveResultUrl({ row, sourceUrl, index, prefix }) {
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

    const fallbackType = prefix === "image" ? "image/png" : "audio/mpeg";
    const contentType = normalizeArchiveContentType(sourceRes.headers.get("content-type"), sourceUrl, bytes, fallbackType);
    const extension = extensionForArchive(contentType, sourceUrl);
    const suffix = index > 0 ? `-${index + 1}` : "";
    const safePrefix = String(prefix || "media").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "media";
    const path = `${row.user_id}/${row.id}-${safePrefix}${suffix}.${extension}`;
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`, {
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
      publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(HISTORY_BUCKET)}/${encodedPath}`
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function normalizeArchiveContentType(value, url, bytes, fallbackType) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (/^(audio|image|video)\//.test(type) && type !== "image/svg+xml") return type;
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.mp3$/.test(clean)) return "audio/mpeg";
  if (/\.wav$/.test(clean)) return "audio/wav";
  if (/\.m4a$/.test(clean)) return "audio/mp4";
  if (/\.aac$/.test(clean)) return "audio/aac";
  if (/\.ogg$/.test(clean)) return "audio/ogg";
  if (/\.flac$/.test(clean)) return "audio/flac";
  if (/\.webm$/.test(clean)) return "video/webm";
  if (/\.mp4$/.test(clean)) return "video/mp4";
  if (/\.png$/.test(clean)) return "image/png";
  if (/\.(jpg|jpeg)$/.test(clean)) return "image/jpeg";
  if (/\.webp$/.test(clean)) return "image/webp";
  if (/\.gif$/.test(clean)) return "image/gif";
  const head = new Uint8Array(bytes || new ArrayBuffer(0)).slice(0, 16);
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "audio/mpeg";
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45) return "audio/wav";
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return "audio/ogg";
  if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) return "audio/flac";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  return fallbackType || "audio/mpeg";
}

function extensionForArchive(contentType, url) {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  if (match && /^(mp3|wav|m4a|aac|ogg|flac|mp4|webm|png|jpg|jpeg|webp|gif)$/.test(match[1])) {
    return match[1] === "jpeg" ? "jpg" : match[1];
  }
  if (contentType === "audio/wav") return "wav";
  if (contentType === "audio/mp4" || contentType === "audio/x-m4a") return "m4a";
  if (contentType === "audio/aac") return "aac";
  if (contentType === "audio/ogg") return "ogg";
  if (contentType === "audio/flac") return "flac";
  if (contentType === "video/webm") return "webm";
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "mp3";
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
  if (!claimRes.ok || !Array.isArray(claimedRows) || !claimedRows.length) {
    const latest = await readGenerationById(row.id);
    await patchGeneration(row.id, { result_url: null, meta: { ...(latest?.meta || meta), status: "failed", failed: true, error: reason, failed_at: latest?.meta?.failed_at || failedMeta.failed_at } });
    return { refunded: !!latest?.meta?.refunded, amount, already_claimed: true };
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

async function readGenerationById(id) {
  const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}&select=id,meta&limit=1`, { headers: sb() });
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeStatus(value) {
  const data = value?.data || value || {};
  const raw = data?.state ?? data?.status ?? value?.status ?? value?.state ?? data?.successFlag ?? value?.successFlag ?? "";
  const state = String(raw).trim().toLowerCase();
  if (["1", "success", "succeeded", "completed", "complete", "done", "ready", "finished"].includes(state)) return "done";
  if (["2", "3", "fail", "failed", "failure", "error", "errored", "canceled", "cancelled", "rejected", "blocked", "moderation_failed", "sensitive_word_error", "generate_audio_failed", "create_task_failed"].includes(state)) return "failed";
  return "pending";
}

function normalizeSunoStatus(value) {
  const tokens = collectStatusTokens(value);
  const failures = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR", "FAILED", "FAIL", "FAILURE", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "REJECTED", "BLOCKED"]);
  if (tokens.some((token) => failures.has(token))) return "failed";
  if (tokens.some((token) => /(FAIL|ERROR|REJECT|BLOCK|SENSITIVE|COPYRIGHT|INVALID|CANCEL)/.test(token))) return "failed";
  if (tokens.includes("2") || tokens.includes("3")) return "failed";
  if (tokens.includes("SUCCESS") || tokens.includes("1")) return "success";
  return "pending";
}

function collectStatusTokens(value) {
  const tokens = [];
  const statusKeys = /^(status|state|successflag|code|error|errormessage|failmsg|message|msg)$/i;
  const containerKeys = /^(data|result|response|task|job|sunodata)$/i;
  function add(raw) {
    if (raw === null || raw === undefined || typeof raw === "object") return;
    const token = String(raw).trim().toUpperCase();
    if (token) tokens.push(token);
  }
  function walk(node, depth = 0) {
    if (!node || depth > 8) return;
    if (typeof node === "string") {
      const parsed = safeJson(node);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) walk(parsed, depth + 1);
      return;
    }
    if (Array.isArray(node)) return node.forEach((item) => walk(item, depth + 1));
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (statusKeys.test(key)) add(child);
      if (statusKeys.test(key) || containerKeys.test(key)) walk(child, depth + 1);
    }
  }
  walk(value);
  return [...new Set(tokens)];
}

function isFinalFailure(value, httpStatus) {
  const data = value?.data || value || {};
  const flag = data?.successFlag ?? value?.successFlag;
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return true;
  const state = String(data?.state || data?.status || value?.state || value?.status || "").trim().toLowerCase();
  if (["fail", "failed", "failure", "error", "errored", "canceled", "cancelled", "rejected", "blocked", "moderation_failed", "sensitive_word_error", "generate_audio_failed", "create_task_failed"].includes(state)) return true;
  const code = Number(value?.code);
  const msg = String(value?.msg || value?.message || value?.error || data?.msg || data?.message || data?.error || "").toLowerCase();
  if (Number.isFinite(code) && code !== 200 && /(fail|failed|rejected|blocked|moderation|sensitive|invalid|not supported)/i.test(msg)) return true;
  return false;
}

function failureReason(value) {
  const messages = [];
  const messageKeys = /^(error|errormessage|failmsg|message|msg|status|state)$/i;
  const containerKeys = /^(data|result|response|task|job|sunodata)$/i;
  function walk(node, depth = 0) {
    if (!node || depth > 8) return;
    if (typeof node === "string") {
      const parsed = safeJson(node);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, depth + 1);
      const clean = node.trim();
      if (clean) messages.push(clean);
      return;
    }
    if (Array.isArray(node)) return node.forEach((item) => walk(item, depth + 1));
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (messageKeys.test(key) || containerKeys.test(key)) walk(child, depth + 1);
    }
  }
  walk(value);
  const useful = messages.find((text) => /(fail|error|reject|block|moderation|sensitive|invalid|cancel)/i.test(text));
  return useful || messages[0] || "kie_failed";
}

function normalizeComparableUrl(url) { return String(url || "").replace(/[)"'\\\]}]+$/g, "").trim(); }
function isBlockedUrl(url) {
  const clean = normalizeComparableUrl(url).toLowerCase();
  return !clean ||
    clean.includes("/.netlify/functions/audio-kie-callback") ||
    clean.includes("/.netlify/functions/run-audio") ||
    clean.includes("/api/callback") ||
    clean.includes("callbackurl=") ||
    clean.includes("callback");
}
function isKnownInputUrl(url, excludeUrls) {
  const clean = normalizeComparableUrl(url);
  return excludeUrls.map(normalizeComparableUrl).filter(Boolean).includes(clean);
}
function collectKnownInputUrls(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const urls = [];
  const seen = new Set();
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(value, trusted = false, depth = 0) {
    if (!value || depth > 8) return;
    if (typeof value === "string") {
      const parsed = safeJson(value);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, trusted, depth + 1);
      if (trusted) (value.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(value)) return value.forEach((item) => walk(item, trusted, depth + 1));
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        walk(child, trusted || /^(input|request|source|reference|audio_url|audioUrl|fileUrl|file_url)$/i.test(key), depth + 1);
      }
    }
  }
  walk(meta.request, true);
  walk(meta.input, true);
  return urls;
}

function collectSunoFinalAudioUrls(value, excludeUrls = []) {
  const urls = [];
  const seen = new Set();
  const finalAudioKeys = new Set(["audioUrl", "audio_url", "downloadUrl", "download_url", "sourceAudioUrl", "source_audio_url", "originAudioUrl", "origin_audio_url"]);
  const containerKeys = new Set(["data", "result", "results", "response", "sunoData", "tracks", "songs", "items"]);
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    const lower = clean.toLowerCase();
    if (!clean || isBlockedUrl(clean) || isKnownInputUrl(clean, excludeUrls) || seen.has(clean)) return;
    if (lower.includes("streamaudiourl") || lower.includes("stream_audio")) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(x, trusted = false, depth = 0, keyPath = "") {
    if (!x || depth > 10 || urls.length >= 4) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, trusted, depth + 1, keyPath);
      if (trusted) (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item) => walk(item, trusted, depth + 1, keyPath));
    if (typeof x === "object") {
      for (const [rawKey, child] of Object.entries(x)) {
        const key = String(rawKey || "");
        if (/streamAudioUrl|stream_audio_url/i.test(key)) continue;
        const nextTrusted = trusted || finalAudioKeys.has(key);
        if (nextTrusted || containerKeys.has(key)) walk(child, nextTrusted, depth + 1, keyPath ? `${keyPath}.${key}` : key);
      }
    }
  }
  walk(value);
  return urls.slice(0, 4);
}

function collectAudioUrls(value, excludeUrls = []) {
  const urls = [];
  const seen = new Set();
  const outputKeys = new Set(["audio_url", "audioUrl", "audioURL", "sourceAudioUrl", "downloadUrl", "download_url", "fileUrl", "file_url", "mediaUrl", "media_url", "resultUrl", "result_url", "url", "urls", "output", "outputs", "audio", "audios", "sunoData", "tracks", "data"]);
  const containerKeys = new Set(["data", "result", "results", "response", "task", "job", "output", "outputs", "sunoData", "tracks"]);
  const blockedKey = /(callback|callBackUrl|callbackUrl|input|request|payload|params|parameters|metadata|meta|reference)/i;
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || isBlockedUrl(clean) || isKnownInputUrl(clean, excludeUrls) || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function walk(x, trusted = false, depth = 0, keyPath = "") {
    if (!x || depth > 10 || urls.length >= 8) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return walk(parsed, trusted, depth + 1, keyPath);
      if (trusted) (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item) => walk(item, trusted, depth + 1, keyPath));
    if (typeof x === "object") {
      for (const [rawKey, child] of Object.entries(x)) {
        const key = String(rawKey || "");
        if (blockedKey.test(key) && !/^(audio_url|audioUrl|audioURL|sourceAudioUrl)$/i.test(key)) continue;
        const nextTrusted = trusted || outputKeys.has(key);
        if (nextTrusted || containerKeys.has(key)) walk(child, nextTrusted, depth + 1, keyPath ? `${keyPath}.${key}` : key);
      }
    }
  }
  walk(value);
  return urls.slice(0, 4);
}

function collectImageUrls(value, excludeUrls = []) {
  const urls = [];
  const seen = new Set();
  function add(url) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    const clean = normalizeComparableUrl(url);
    if (!clean || isBlockedUrl(clean) || isKnownInputUrl(clean, excludeUrls) || seen.has(clean)) return;
    if (!/\.(png|jpe?g|webp)(\?|#|$)/i.test(clean) && !/image/i.test(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }
  function scan(x, depth = 0) {
    if (!x || depth > 10) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return scan(parsed, depth + 1);
      (x.match(/https?:\/\/[^\s"'<>]+/gi) || []).forEach(add);
      return;
    }
    if (Array.isArray(x)) return x.forEach((item) => scan(item, depth + 1));
    if (typeof x === "object") Object.values(x).forEach((v) => scan(v, depth + 1));
  }
  scan(value);
  return urls;
}
