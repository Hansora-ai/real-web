// netlify/functions/audio-eleven-background.mjs
// Long-running ElevenLabs worker for Hansora audio jobs.
// Env: AUDIO_WORKER_SECRET (optional), Elevan_labs_api1 (or ELEVENLABS_API_KEY), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ELEVENLABS_API_KEY = process.env.Elevan_labs_api1 || process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.Eleven_labs_api || process.env.eleven_labs_api || process.env.XI_API_KEY || "";
const ELEVENLABS_BASE = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/,"");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WORKER_SECRET = process.env.AUDIO_WORKER_SECRET || SERVICE_KEY;
const SUPABASE_AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET || process.env.SUPABASE_BUCKET || "downloads";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

export default async (req) => {
  const secret = req.headers.get("x-hansora-worker-secret") || "";
  if (!WORKER_SECRET || secret !== WORKER_SECRET) throw new Error("unauthorized_worker");

  const payload = await req.json().catch(() => ({}));
  const uid = String(payload.uid || "").trim();
  const run_id = String(payload.run_id || payload.runId || "").trim();
  const kind = normalizeKind(payload.kind || "");
  const cost = Number(payload.cost || 0);
  const body = payload.body && typeof payload.body === "object" ? payload.body : {};
  if (!uid || !run_id || !kind) throw new Error("missing_worker_ids");

  try {
    await patchTaskMeta(uid, run_id, { status:"processing", worker_started_at:new Date().toISOString() });
    let resultUrl = "";
    let request = {};

    if (kind === "voice") {
      const dialogue = normalizeDialogue(body.dialogue);
      if (!dialogue.length) throw new Error("empty_dialogue");
      const stability = clampNumber(body.stability, 0, 1, 0.5);
      const languageCode = normalizeLanguageCode(body.language_code || body.languageCode || "");
      const elevenPayload = dialogue.length === 1 ? {
        text: dialogue[0].text,
        model_id:"eleven_v3",
        voice_settings:{ stability, similarity_boost:0.85, style:0, use_speaker_boost:true }
      } : {
        inputs:dialogue.map((item)=>({ text:item.text, voice_id:item.voice })),
        model_id:"eleven_v3",
        settings:{ stability }
      };
      if (languageCode) elevenPayload.language_code = languageCode;
      const audioPath = dialogue.length === 1 ? `/v1/text-to-speech/${encodeURIComponent(dialogue[0].voice)}?output_format=mp3_44100_128` : "/v1/text-to-dialogue?output_format=mp3_44100_128";
      const audio = await postElevenJsonAudio(audioPath, elevenPayload);
      resultUrl = await storeGeneratedAudio({ uid, run_id, kind, bytes:audio.bytes, contentType:audio.contentType, fileName:"dialogue.mp3" });
      request = elevenPayload;
    } else if (kind === "isolation") {
      const source = await readInputAudio(body, normalizeUrl(body.audio_url || body.audioUrl || ""));
      if (!source.bytes.length) throw new Error("missing_audio_file");
      const audio = await postElevenMultipartAudio("/v1/audio-isolation", source, {});
      resultUrl = await storeGeneratedAudio({ uid, run_id, kind, bytes:audio.bytes, contentType:audio.contentType, fileName:"voice-isolated.mp3" });
      request = { input:{ audio_url:body.audio_url || source.fileName } };
    } else if (kind === "voice-change") {
      const voiceId = normalizeVoiceId(body.voice || body.voice_id || body.voiceId || "");
      if (!voiceId) throw new Error("missing_voice");
      const source = await readInputAudio(body, normalizeUrl(body.audio_url || body.audioUrl || ""));
      if (!source.bytes.length) throw new Error("missing_audio_file");
      const removeNoise = body.remove_background_noise !== false && body.removeBackgroundNoise !== false;
      const audio = await postElevenMultipartAudio(`/v1/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, source, {
        model_id:"eleven_multilingual_sts_v2",
        remove_background_noise:String(removeNoise)
      });
      resultUrl = await storeGeneratedAudio({ uid, run_id, kind, bytes:audio.bytes, contentType:audio.contentType, fileName:"voice-changed.mp3" });
      request = { input:{ audio_url:body.audio_url || source.fileName, voice_id:voiceId, remove_background_noise:removeNoise } };
    } else {
      throw new Error("unsupported_worker_kind");
    }

    await markReady(uid, run_id, { kind, provider:providerTitle(kind), cost, resultUrl, request:stripLargeFields(request) });
  } catch (error) {
    const row = await readGenerationRow(uid, run_id);
    if (row) await failAndRefundOnce({ row, ids:{ uid, run_id, taskId:run_id }, reason:messageOf(error) });
    else await patchTaskMeta(uid, run_id, { status:"failed", failed:true, error:messageOf(error), failed_at:new Date().toISOString() });
    return json({ ok:false, error:messageOf(error) }, 200);
  }

  return json({ ok:true }, 200);
};

function normalizeKind(k){ const s=String(k||"").toLowerCase().replace(/_/g,"-"); return s === "voice-changer" ? "voice-change" : s; }
function providerTitle(kind){ return kind === "isolation" ? "Voice Isolation" : kind === "voice-change" ? "Voice Changer" : "Text to Dialogue"; }
function messageOf(error){ return error && error.message ? error.message : String(error); }
function sb(){ return { apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}` }; }
function normalizeUrl(u){ try { return new URL(String(u || "")).href; } catch { return ""; } }
function clampNumber(value, min, max, fallback){ const n=Number(value); if (!Number.isFinite(n)) return fallback; return Math.max(min, Math.min(max, n)); }
function sanitizeFileName(name){ return String(name || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,90) || "audio.mp3"; }
function normalizeLanguageCode(value){
  const raw = String(value || "").trim().toLowerCase();
  const allowed = new Set(["en","ja","zh","de","hi","fr","ko","pt","it","es","id","nl","tr","fil","pl","sv","bg","ro","ar","cs","el","fi","hr","ms","sk","da","ta","uk","ru","hu","no","vi","hy"]);
  return allowed.has(raw) ? raw : "";
}
function normalizeVoiceId(value){
  const s = String(value || "").trim();
  const aliases = { Rachel:"21m00Tcm4TlvDq8ikWAM", Aria:"9BWtsMINqrJLrRacOk9x", Roger:"CwhRBWXzGAHq8TQ4Fs17", Sarah:"EXAVITQu4vr4xnSDxMaL" };
  const id = aliases[s] || s;
  return /^[A-Za-z0-9_-]{8,}$/.test(id) ? id : "";
}
function normalizeDialogue(input){
  const arr = Array.isArray(input) ? input : [];
  return arr.map((item)=>({ text:String(item?.text || "").trim(), voice:normalizeVoiceId(item?.voice || "") })).filter((item)=>item.text && item.voice);
}
function guessMimeFromName(name){
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "audio/mpeg";
}
function isSupportedAudioFile(fileName, fileType){
  const type = String(fileType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (type.startsWith("video/")) return false;
  if (type.startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
}
async function readInputAudio(body, audioUrl){
  const fileName = sanitizeFileName(body.fileName || `audio-${Date.now()}.mp3`);
  const fileType = String(body.fileType || guessMimeFromName(fileName) || "audio/mpeg").toLowerCase();
  if (!isSupportedAudioFile(fileName, fileType)) throw new Error("unsupported_file_type_audio_only");
  if (audioUrl) {
    const r = await fetch(audioUrl);
    if (!r.ok) throw new Error("audio_url_fetch_failed");
    return { bytes:Buffer.from(await r.arrayBuffer()), contentType:r.headers.get("content-type") || fileType, fileName };
  }
  const fileBase64 = String(body.fileBase64 || body.base64Data || "");
  if (!fileBase64) return { bytes:Buffer.alloc(0), contentType:fileType, fileName };
  const comma = fileBase64.indexOf(",");
  const raw = comma >= 0 ? fileBase64.slice(comma + 1) : fileBase64;
  return { bytes:Buffer.from(raw, "base64"), contentType:fileType, fileName };
}
async function postElevenJsonAudio(path, payload){
  const r = await fetch(ELEVENLABS_BASE + path, { method:"POST", headers:{ "xi-api-key":ELEVENLABS_API_KEY, "Content-Type":"application/json", Accept:"audio/mpeg" }, body:JSON.stringify(payload) });
  return await elevenAudioResponse(r);
}
async function postElevenMultipartAudio(path, source, fields){
  const { body, contentType } = buildMultipartBody(source, fields);
  const r = await fetch(ELEVENLABS_BASE + path, {
    method:"POST",
    headers:{ "xi-api-key":ELEVENLABS_API_KEY, Accept:"audio/mpeg", "Content-Type":contentType },
    body
  });
  return await elevenAudioResponse(r);
}
function buildMultipartBody(source, fields){
  const boundary = `----hansora-eleven-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const push = (value)=>chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null || value === "") continue;
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${String(key).replace(/"/g, "")}"\r\n\r\n`);
    push(`${String(value)}\r\n`);
  }
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="audio"; filename="${sanitizeFileName(source.fileName || "audio.mp3")}"\r\n`);
  push(`Content-Type: ${source.contentType || "audio/mpeg"}\r\n\r\n`);
  push(source.bytes);
  push(`\r\n--${boundary}--\r\n`);
  return { body:Buffer.concat(chunks), contentType:`multipart/form-data; boundary=${boundary}` };
}
async function elevenAudioResponse(r){
  const contentType = r.headers.get("content-type") || "audio/mpeg";
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!r.ok) {
    let message = `elevenlabs_${r.status}`;
    if (/json|text/i.test(contentType)) {
      const text = bytes.toString("utf8");
      try { const json = JSON.parse(text); message = json?.detail?.message || json?.detail || json?.message || json?.error || message; }
      catch { message = text.slice(0,240) || message; }
    }
    throw new Error(String(message));
  }
  if (!bytes.length) throw new Error("elevenlabs_empty_audio");
  return { bytes, contentType };
}
async function storeGeneratedAudio({ uid, run_id, bytes, contentType, fileName }){
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("missing_supabase_storage_env");
  const safeName = sanitizeFileName(fileName || "audio.mp3");
  const objectPath = `audio/generated/${encodeURIComponent(uid).replace(/%/g,"")}/${encodeURIComponent(run_id).replace(/%/g,"")}/${Date.now()}-${safeName}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${objectPath}`, {
    method:"POST",
    headers:{ ...sb(), "Content-Type":contentType || "audio/mpeg", "x-upsert":"true" },
    body:bytes
  });
  if (!r.ok) throw new Error(`supabase_audio_upload_failed: ${(await r.text().catch(()=>"")).slice(0,180)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${objectPath}`;
}
function stripLargeFields(obj){
  const copy = JSON.parse(JSON.stringify(obj || {}));
  if (copy.input && copy.input.audio_url) copy.input.audio_url = copy.input.audio_url;
  return copy;
}
async function readGenerationRow(uid, run_id){
  if (!UG_URL || !SERVICE_KEY) return null;
  const q = `?select=id,user_id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
  const r = await fetch(UG_URL + q, { headers:sb() });
  const arr = await r.json().catch(()=>[]);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}
async function readGenerationMeta(uid, run_id){
  const row = await readGenerationRow(uid, run_id);
  return row?.meta || {};
}
async function patchTaskMeta(uid, run_id, extraMeta){
  if (!UG_URL || !SERVICE_KEY) return;
  const current = await readGenerationMeta(uid, run_id);
  const nextMeta = { ...(current || {}), run_id, ...extraMeta };
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
  await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=minimal" }, body:JSON.stringify({ meta:nextMeta }) });
}
async function markReady(uid, run_id, { kind, provider, cost, resultUrl, request }){
  const meta = {
    ...(await readGenerationMeta(uid, run_id) || {}),
    run_id, status:"ready", failed:false, error:null, task_id:run_id,
    audio_kind:kind, provider, title:provider, audio_url:resultUrl, audio_urls:[resultUrl],
    completed_at:new Date().toISOString(), estimated_cost:cost, refund_amount:cost, request
  };
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
  await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=minimal" }, body:JSON.stringify({ result_url:resultUrl, provider, meta }) });
}
async function patchGenerationById(id, payload){
  const r = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", Prefer:"return=minimal" }, body:JSON.stringify(payload) });
  return r.ok;
}
async function failAndRefundOnce({ row, ids, reason }){
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || meta.charged_cost || meta.estimated_cost || 0);
  const failedMeta = { ...meta, run_id:ids.run_id || meta.run_id || "", task_id:ids.taskId || meta.task_id || meta.taskId || "", status:"failed", failed:true, error:reason, failed_at:new Date().toISOString() };
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
function json(body, status = 200){
  return new Response(JSON.stringify(body), { status, headers:{ "Content-Type":"application/json" } });
}
