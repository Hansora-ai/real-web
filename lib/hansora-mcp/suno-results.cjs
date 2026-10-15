// Shared parsing for Suno callback completion and recovery of stored callbacks.
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
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
  // Callback events use callbackType rather than the polling API's status field.
  const event = String(data?.callbackType || body?.callbackType || "").toLowerCase();
  if (event === "error" || (body?.code != null && Number(body.code) !== 200)) return "failed";
  if (event === "complete") return "success";
  return "pending";
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

module.exports = { normalizeSunoStatus, extractSunoFinalAudioUrls, normalizeComparableUrl, isBlockedUrl, collectKnownInputUrls };
