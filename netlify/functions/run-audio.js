// netlify/functions/run-audio.js
// Submit Hansora audio jobs and seed user_generations placeholders.
// Voice, isolation, and voice changer use ElevenLabs directly. Music stays on KIE/Suno.
// Env: KIE_API_KEY, Elevan_labs_api1 (or ELEVENLABS_API_KEY), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: SITE_BASE (otherwise the current request domain is used)

const API_KEY = process.env.KIE_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.Elevan_labs_api1 || process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.Eleven_labs_api || process.env.eleven_labs_api || process.env.XI_API_KEY || "";
const ELEVENLABS_BASE = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/,"");
const MARKET_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const SUNO_GENERATE_URL = "https://api.kie.ai/api/v1/generate";
const KIE_BASE64_UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const SUPABASE_AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET || process.env.SUPABASE_BUCKET || "downloads";
const SUPPORTED_DIALOGUE_VOICES = new Set(['EkK5I93UQWFDigLMpZcX', 'Z3R5wn05IrDiVCyEkUrK', 'NNl6r8mD7vthiJatiJt1', 'YOq2y2Up4RgXP2HyXjE5', '2zRM7PkgwBPiau2jvVXc', '1SM7GgM6IMuvQlz2BwM3', 'NOpBlnGInO9m6vDvFkFC', 'BZgkqPqms7Kj9ulSkVzn', 'gU0LNdkMOQCOrPrwtbee', 'DGzg6RaUqxGRTHSBjfgF', 'SOYHLrjzK2X1ezoPC6cr', 'hpp4J3VqNfWAUOO0d1Us', 'pNInz6obpgDQGcFmaJgB', 'flHkNRp1BlvT73UL6gyz', '9yzdeviXkFddZ4Oz8Mok', 'U1Vk2oyatMdYs096Ety7', 'Bj9UqZbhQsanLzgalpEG', 'exsUS4vynmxd379XN4yO', 'BpjGufoPiobT79j2vtj4', 'ouL9IsyrSnUkCmfnD02u', 'RILOU7YmBhvwJGDGjNmP', 'aMSt68OGf4xUZAnLpTU8', 'tnSpp4vdxKPjI9w0GnoV', 'wyWA56cQNU2KqUW4eCsI', 'zNsotODqUhvbJ5wMG7Ei', 'QzgYVYSNBgksoEWDkpKt', 'kdmDKE6EkgrWrrykO9Qt', 'M0IvLNu6hH3cNnETNLEP', 'bMxLr8fP6hzNRRi9nJxU', 'bU2VfAdiOb2Gv2eZWlFq', 'gUABw7pXQjhjt0kNFBTF', 'Rachel', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill', 'B8gJV1IhpuegLxdpXFOE', '5l5f8iK3YPeGga21rQIX', 'wo6udizrrtpIxWGp2qJk', 'x70vRnQBMBu4FAYhjJbO', 'P1bg08DkjqiVEzOn76yG', 'qDuRKMlYmrm8trt5QyBn', 'qXpMhyvQqiRxWQs4qSSB', 'TX3LPaxmHKxFdv7VOQHJ', 'N2lVS1w4EtoT3dr4eOWO', 'FGY2WhTYpPnrIDTdsKH5', 'kPzsL2i3teMYv0FxEYQ6', 'nPczCjzI2devNBz1zQrb', 'uYXf8XasLslADfZ2MB4u', 'gs0tAILXbY5DNrJrsM6F', 'DTKMou8ccj1ZaWGBiotd', 'vBKc2FfBKJfcZNyEt1n6', 'DYkrAHD8iwork3YSUBbs', '56AoDkrOh6qfVPDXZ7Pt', 'eR40ATw9ArzDf9h3v7t7', 'g6xIsTj2HwM6VR4iXFCw', 'lcMyyd2HUfFzxdCaC4Ta', '6aDn1KB0hjpdcocrUkmq', 'Sq93GQT4X1lKDXsQcixO', 'pPdl9cQBQq4p6mRkZy2Z', 'zYcjlYFOd3taleS0gkk3', 'nzeAacJi50IvxcyDnMXa', 'ruirxsoakN0GWmGNIo04', 'TC0Zp7WVFzhA8zpTlRqV', 'ljo9gAlSqKOvF6D8sOsX', 'PPzYpIqttlTYA83688JI', '8JVbfL6oEdmuxKn5DK2C', 'iCrDUkL56s3C8sCRl7wb', 'wJqPPQ618aTW29mptyoc', 'EiNlNiXeDU1pqqOPrYMO', '4YYIPFl9wE5c4L2eu2Gb', '6F5Zhi321D3Oq7v1oNT4', 'YXpFCvM1S3JbWEJhoskW', 'LG95yZDEHg6fCZdQjLqj', 'CeNX9CMwmxDxUF5Q2Inm', 'aD6riP1btT197c6dACmy', 'mtrellq69YZsNwzUSyXh', 'dHd5gvgSOzSfduK4CvEg', 'eVItLK1UvXctxuaRV2Oq', 'esy0r39YPLQjOczyOib8', 'D2jw4N9m4xePLTQ3IHjU', 'Tsns2HvNFKfGiNjllgqo', '1U02n4nD6AdIZ9CjF053', 'AeRdCCKzvd23BpJoofzx', 'LruHrtVF6PSyGItzMNHS', '1wGbFxmAM3Fgw63G1zZJ', 'hqfrgApggtO1785R4Fsn', 'MJ0RnG71ty4LH3dvNfSd', 'scOwDtmlUjD3prqpp97I', 'Sm1seazb4gs7RSlUVw7c']);
const DEFAULT_DIALOGUE_VOICE = 'EkK5I93UQWFDigLMpZcX';
const VOICE_ALIASES = {
  Rachel:"21m00Tcm4TlvDq8ikWAM", Aria:"9BWtsMINqrJLrRacOk9x", Roger:"CwhRBWXzGAHq8TQ4Fs17", Sarah:"EXAVITQu4vr4xnSDxMaL",
  Laura:"FGY2WhTYpPnrIDTdsKH5", Charlie:"IKne3meq5aSn9XLyUdCD", George:"JBFqnCBsd6RMkjVDRZzb", Callum:"N2lVS1w4EtoT3dr4eOWO",
  River:"SAz9YHcvj6GT2YYXdXww", Liam:"TX3LPaxmHKxFdv7VOQHJ", Charlotte:"XB0fDUnXU5powFXDhCwa", Alice:"Xb7hH8MSUJpSbSDYk0k2",
  Matilda:"XrExE9yKIg1WjnnlVkGX", Will:"bIHbv24MWmeRgasZH58o", Eric:"cjVigY5qzO86Huf0OWal", Chris:"iP95p4xoKVk53GoZ742B",
  Brian:"nPczCjzI2devNBz1zQrb", Daniel:"onwK4e9ZLuTAKqWW03F9", Lily:"pFZP5JQG7iQjIQuC4Bku", Bill:"pqHfZKP75CvOlQylNhV4"
};
Object.values(VOICE_ALIASES).forEach((id)=>SUPPORTED_DIALOGUE_VOICES.add(id));

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WORKER_SECRET = process.env.AUDIO_WORKER_SECRET || SERVICE_KEY;
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

const SITE_BASE_ENV = (process.env.SITE_BASE || "").replace(/\/+$/,"");


exports.handler = async (event) => {
  let failureContext = null;
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);
    const kind = normalizeKind(body.kind || "voice");
    const siteBase = resolveSiteBase(headers);
    const callbackBase = `${siteBase}/.netlify/functions/audio-kie-callback`;
    const elevenBackgroundUrl = `${siteBase}/.netlify/functions/audio-eleven-background`;
    if (kind === "voice-list") {
      if (!ELEVENLABS_API_KEY) return ok({ submitted:false, error:"missing_elevenlabs_key", voices:[] });
      const voices = await listElevenVoices();
      return ok({ submitted:true, voices });
    }
    if (kind === "voice-preview") {
      if (!ELEVENLABS_API_KEY) return ok({ submitted:false, error:"missing_elevenlabs_key" });
      const voiceId = normalizeVoiceId(body.voice || body.voice_id || body.voiceId || "");
      if (!voiceId) return ok({ submitted:false, error:"missing_voice" });
      const previewText = String(body.text || "This is a preview of this voice on Hansora.").trim().slice(0, 180) || "This is a preview of this voice on Hansora.";
      const stability = clampNumber(body.stability, 0, 1, 0.5);
      const audio = await postElevenJsonAudio(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        text: previewText,
        model_id: "eleven_v3",
        voice_settings: { stability, similarity_boost:0.85, style:0, use_speaker_boost:true }
      });
      return ok({
        submitted:true,
        preview:true,
        content_type:audio.contentType || "audio/mpeg",
        audio_base64:audio.bytes.toString("base64"),
        audio_data_url:`data:${audio.contentType || "audio/mpeg"};base64,${audio.bytes.toString("base64")}`
      });
    }
    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_uid" });

    const authz = (headers["authorization"] || "").toString();
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted:false, error:"missing_auth" });

    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted:false, error:"auth_mismatch" });

    const cost = calculateCost(kind, body);
    const clientRunId = (body.run_id || body.runId || "").toString().trim();
    const run_id = clientRunId || `${uid}-audio-${Date.now()}`;
    const existing = await getExistingTask(uid, run_id);
    if (existing && (existing.taskId || existing.resultUrl)) return ok({ submitted:true, run_id, taskId:existing.taskId, result_url:existing.resultUrl, already:true });

    const charged = await isCharged(uid, run_id);
    if (!charged) {
      const available = await getCredits(uid);
      if (available < cost) return ok({ submitted:false, error:"not_enough_credits", run_id });
    }

    const prompt = buildPromptForRow(kind, body);
    await seedPlaceholder(uid, run_id, { kind, prompt, cost, title: providerTitle(kind) });
    failureContext = { uid, run_id, kind, cost };

    const callBackUrl = `${callbackBase}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}&kind=${encodeURIComponent(kind)}`;
    let resp;
    let kiePayload;

    if (kind === "voice") {
      if (!ELEVENLABS_API_KEY) return ok({ submitted:false, error:"missing_elevenlabs_key", run_id });
      const dialogue = normalizeDialogue(body.dialogue);
      if (!dialogue.length) return ok({ submitted:false, error:"empty_dialogue", run_id });
      const stability = clampNumber(body.stability, 0, 1, 0.5);
      const languageCode = normalizeLanguageCode(body.language_code || body.languageCode || "");
      if (!charged) {
        const debited = await debitCredits(uid, cost);
        if (!debited) return ok({ submitted:false, error:"debit_failed", run_id });
        await markCharged(uid, run_id, cost, run_id);
        failureContext.charged = true;
      }
      const workerBody = { dialogue, stability, language_code:languageCode, prompt:body.prompt || "" };
      await invokeElevenBackground({ uid, run_id, kind, cost, body:workerBody }, elevenBackgroundUrl);
      await patchTaskMeta(uid, run_id, { status:"processing", task_id:run_id, kind, provider:providerTitle(kind), cost, background:true, request:stripLargeFields(workerBody) });
      return ok({ submitted:true, run_id, taskId:run_id, status:202, data:{ provider:"elevenlabs", kind, background:true } });
    } else if (kind === "isolation") {
      if (!ELEVENLABS_API_KEY) return ok({ submitted:false, error:"missing_elevenlabs_key", run_id });
      let audioUrl = normalizeUrl(body.audio_url || body.audioUrl || "");
      if (!audioUrl && !String(body.fileBase64 || body.base64Data || "")) return ok({ submitted:false, error:"missing_audio_file", run_id });
      const fileName = sanitizeFileName(body.fileName || `audio-${Date.now()}.mp3`);
      const fileType = String(body.fileType || "").toLowerCase();
      if (!isSupportedAudioFile(fileName, fileType)) return ok({ submitted:false, error:"unsupported_file_type_audio_only", run_id });
      if (!charged) {
        const debited = await debitCredits(uid, cost);
        if (!debited) return ok({ submitted:false, error:"debit_failed", run_id });
        await markCharged(uid, run_id, cost, run_id);
        failureContext.charged = true;
      }
      const workerBody = { audio_url:audioUrl, fileBase64:body.fileBase64 || body.base64Data || "", fileName, fileType };
      await invokeElevenBackground({ uid, run_id, kind, cost, body:workerBody }, elevenBackgroundUrl);
      await patchTaskMeta(uid, run_id, { status:"processing", task_id:run_id, kind, provider:providerTitle(kind), cost, background:true, request:stripLargeFields({ input:{ audio_url:audioUrl || fileName } }) });
      return ok({ submitted:true, run_id, taskId:run_id, status:202, data:{ provider:"elevenlabs", kind, background:true } });
    } else if (kind === "voice-change") {
      if (!ELEVENLABS_API_KEY) return ok({ submitted:false, error:"missing_elevenlabs_key", run_id });
      const voiceId = normalizeVoiceId(body.voice || body.voice_id || body.voiceId || "");
      if (!voiceId) return ok({ submitted:false, error:"missing_voice", run_id });
      let audioUrl = normalizeUrl(body.audio_url || body.audioUrl || "");
      if (!audioUrl && !String(body.fileBase64 || body.base64Data || "")) return ok({ submitted:false, error:"missing_audio_file", run_id });
      const fileName = sanitizeFileName(body.fileName || `audio-${Date.now()}.mp3`);
      const fileType = String(body.fileType || "").toLowerCase();
      if (!isSupportedAudioFile(fileName, fileType)) return ok({ submitted:false, error:"unsupported_file_type_audio_only", run_id });
      const removeNoise = body.remove_background_noise !== false && body.removeBackgroundNoise !== false;
      if (!charged) {
        const debited = await debitCredits(uid, cost);
        if (!debited) return ok({ submitted:false, error:"debit_failed", run_id });
        await markCharged(uid, run_id, cost, run_id);
        failureContext.charged = true;
      }
      const workerBody = { audio_url:audioUrl, fileBase64:body.fileBase64 || body.base64Data || "", fileName, fileType, voice:voiceId, remove_background_noise:removeNoise };
      await invokeElevenBackground({ uid, run_id, kind, cost, body:workerBody }, elevenBackgroundUrl);
      await patchTaskMeta(uid, run_id, { status:"processing", task_id:run_id, kind, provider:providerTitle(kind), cost, background:true, request:stripLargeFields({ input:{ audio_url:audioUrl || fileName, voice_id:voiceId, remove_background_noise:removeNoise } }) });
      return ok({ submitted:true, run_id, taskId:run_id, status:202, data:{ provider:"elevenlabs", kind, background:true } });
    } else if (kind === "music") {
      const music = normalizeMusicPayload(body);
      if (!music.customMode && !music.prompt) return ok({ submitted:false, error:"empty_prompt", run_id });
      if (music.customMode && !music.instrumental && !music.prompt) return ok({ submitted:false, error:"empty_lyrics", run_id });
      if (music.customMode && (!music.style || !music.title)) return ok({ submitted:false, error:"missing_title_or_style", run_id });
      kiePayload = { ...music, callBackUrl };
      resp = await postJson(SUNO_GENERATE_URL, kiePayload);
    } else {
      return ok({ submitted:false, error:"unsupported_kind", run_id });
    }

    const data = resp.data;
    const kieCode = Number(data && data.code);
    const kieMessage = String((data && (data.msg || data.message || data.error)) || "").trim();
    const taskId = extractTaskId(data);
    if (!resp.ok || (Number.isFinite(kieCode) && kieCode !== 200)) {
      const reason = kieMessage || `kie_${resp.status}`;
      await patchTaskMeta(uid, run_id, { status:"failed", failed:true, error:reason, kind, provider:providerTitle(kind), cost, request:stripLargeFields(kiePayload), response:data });
      return ok({ submitted:false, error:reason, data, run_id });
    }
    if (!taskId) {
      const reason = kieMessage || "missing_taskId";
      await patchTaskMeta(uid, run_id, { status:"failed", failed:true, error:reason, kind, provider:providerTitle(kind), cost, request:stripLargeFields(kiePayload), response:data });
      return ok({ submitted:false, error:reason, data, run_id });
    }

    if (!charged) {
      const debited = await debitCredits(uid, cost);
      if (!debited) return ok({ submitted:false, error:"debit_failed", run_id, taskId });
      await markCharged(uid, run_id, cost, taskId);
    }

    await patchTaskMeta(uid, run_id, { status:"processing", task_id:taskId, kind, provider:providerTitle(kind), cost, request:stripLargeFields(kiePayload) });
    return ok({ submitted:true, run_id, taskId, status:resp.status, data });
  } catch (e) {
    if (failureContext) {
      let refundMeta = {};
      if (failureContext.charged && !(e && e.backgroundHandled)) {
        const refunded = await refundCredits(failureContext.uid, failureContext.cost);
        refundMeta = refunded ? { refunded:true, refunded_cost:failureContext.cost, refunded_at:new Date().toISOString() } : { refund_error:"refund_failed" };
      }
      await patchTaskMeta(failureContext.uid, failureContext.run_id, {
        status:"failed",
        failed:true,
        error:String(e && e.message ? e.message : e),
        kind:failureContext.kind,
        provider:providerTitle(failureContext.kind),
        cost:failureContext.cost,
        ...refundMeta
      });
    }
    return ok({ submitted:false, error:String(e && e.message ? e.message : e) });
  }
};

function ok(obj){ return { statusCode:200, headers:cors(), body:JSON.stringify(obj) }; }
function err(code, message){ return { statusCode:code, headers:cors(), body:JSON.stringify({ submitted:false, error:message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function resolveSiteBase(headers){
  if (SITE_BASE_ENV) return SITE_BASE_ENV;
  const host = String(headers["x-forwarded-host"] || headers.host || "hansora.co").trim();
  const proto = String(headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  return `${proto}://${host}`.replace(/\/+$/,"");
}
function sb(){ return { "apikey":SERVICE_KEY, "Authorization":`Bearer ${SERVICE_KEY}` }; }
function normalizeKind(k){
  const s=String(k||"").toLowerCase().replace(/_/g,"-");
  if (["voice","isolation","music","voice-change","voice-changer","voice-preview","voice-list"].includes(s)) return s === "voice-changer" ? "voice-change" : s;
  return "voice";
}
function providerTitle(kind){ return kind === "music" ? "Suno Music" : kind === "isolation" ? "Voice Isolation" : kind === "voice-change" ? "Voice Changer" : "Text to Dialogue"; }
function normalizeLanguageCode(value){
  const raw = String(value || "").trim().toLowerCase();
  const allowed = new Set(["en","ja","zh","de","hi","fr","ko","pt","it","es","id","nl","tr","fil","pl","sv","bg","ro","ar","cs","el","fi","hr","ms","sk","da","ta","uk","ru","hu","no","vi","hy"]);
  return allowed.has(raw) ? raw : "";
}
function normalizeUrl(u){ try { const url = new URL(String(u || "")); return url.href; } catch { return ""; } }
function clampNumber(value, min, max, fallback){ const n=Number(value); if (!Number.isFinite(n)) return fallback; return Math.max(min, Math.min(max, n)); }
function sanitizeFileName(name){ return String(name || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,90) || "audio.mp3"; }
function isSupportedAudioFile(fileName, fileType){
  const type = String(fileType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (type.startsWith("video/")) return false;
  if (type.startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
}
function normalizeVoiceId(value){
  const requestedVoice = String(value || "").trim();
  const aliased = VOICE_ALIASES[requestedVoice] || requestedVoice;
  if (SUPPORTED_DIALOGUE_VOICES.has(aliased)) return aliased;
  return /^[A-Za-z0-9_-]{8,}$/.test(aliased) ? aliased : "";
}

function calculateCost(kind, body){
  if (kind === "music") return 1.5;
  if (kind === "isolation" || kind === "voice-change") {
    const seconds = clampNumber(body.durationSeconds || body.duration || body.audioDurationSeconds, 0, 86400, 0);
    if (!seconds) return 1;
    return Math.max(0.5, Math.ceil((seconds / 60) * 2) / 2);
  }
  const chars = normalizeDialogue(body.dialogue).reduce((sum, item)=>sum + String(item.text || "").length, 0);
  return Math.max(1, Math.ceil(Math.max(chars, 1) / 1000));
}

function normalizeDialogue(input){
  const arr = Array.isArray(input) ? input : [];
  return arr.map((item)=>{
    const text = String(item && item.text || "").trim();
    const requestedVoice = String(item && item.voice || "").trim();
    const voice = normalizeVoiceId(requestedVoice) || DEFAULT_DIALOGUE_VOICE;
    return { text, voice };
  }).filter((item)=>item.text);
}
function normalizeMusicPayload(body){
  const customMode = body.customMode === true || body.customMode === "true";
  const instrumental = body.instrumental === true || body.instrumental === "true";
  const model = normalizeSunoModel(body.model || "V5_5");
  const prompt = String(body.prompt || "").trim().slice(0, customMode ? 5000 : 500);
  if (!customMode) {
    return { prompt, customMode:false, instrumental, model };
  }
  const payload = {
    customMode:true,
    instrumental,
    model,
    style:String(body.style || "").trim().slice(0,1000),
    title:(String(body.title || "SONG").trim().slice(0,80) || "SONG")
  };
  if (!instrumental || prompt) payload.prompt = prompt;
  const vocalGender = String(body.vocalGender || "").trim().toLowerCase();
  const personaId = String(body.personaId || "").trim();
  const personaModel = String(body.personaModel || "").trim();
  if (!instrumental && (vocalGender === "m" || vocalGender === "f")) payload.vocalGender = vocalGender;
  if (personaId) payload.personaId = personaId.slice(0,120);
  if (personaModel) payload.personaModel = personaModel.slice(0,80);
  ["styleWeight","weirdnessConstraint","audioWeight"].forEach((key)=>{
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") payload[key] = clampNumber(body[key], 0, 1, 0.65);
  });
  return payload;
}
function normalizeSunoModel(model){
  const allowed = new Set(["V5_5","V5","V4_5PLUS","V4_5","V4","V4_5ALL"]);
  const raw = String(model || "V5_5").toUpperCase().replace(/[\s-]/g,"_");
  return allowed.has(raw) ? raw : "V5_5";
}
function buildPromptForRow(kind, body){
  if (kind === "voice") return normalizeDialogue(body.dialogue).map((x)=>x.text).join("\n").slice(0,500);
  if (kind === "isolation") return `Voice isolation${body.fileName ? `: ${body.fileName}` : ""}`;
  if (kind === "voice-change") return `Voice changer${body.fileName ? `: ${body.fileName}` : ""}`;
  return String(body.prompt || body.title || "Music generation").slice(0,500);
}
function stripLargeFields(obj){
  const copy = JSON.parse(JSON.stringify(obj || {}));
  if (copy.input && copy.input.audio_url) copy.input.audio_url = copy.input.audio_url;
  return copy;
}
async function postJson(url, payload){
  const r = await fetch(url, { method:"POST", headers:{ "Authorization":`Bearer ${API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(payload) });
  const data = await r.json().catch(()=>({}));
  return { ok:r.ok, status:r.status, data };
}
async function invokeElevenBackground(payload, elevenBackgroundUrl){
  if (!WORKER_SECRET) throw new Error("missing_worker_secret");
  const r = await fetch(elevenBackgroundUrl, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "X-Hansora-Worker-Secret":WORKER_SECRET },
    body:JSON.stringify(payload)
  });
  const contentType = r.headers.get("content-type") || "";
  const bodyText = await r.text().catch(()=>"");
  let bodyJson = null;
  if (bodyText && /json/i.test(contentType)) {
    try { bodyJson = JSON.parse(bodyText); } catch {}
  }
  if (bodyJson && bodyJson.ok === false) {
    const error = new Error(bodyJson.error || "eleven_background_failed");
    error.backgroundHandled = true;
    throw error;
  }
  if (![200,202,204].includes(r.status)) {
    if (r.status === 404) throw new Error(`missing_deployed_background_function: ${elevenBackgroundUrl}`);
    throw new Error(`eleven_background_invoke_failed_${r.status}${bodyText ? `: ${bodyText.slice(0,160)}` : ""}`);
  }
  return true;
}
async function getElevenJson(path){
  const r = await fetch(ELEVENLABS_BASE + path, {
    method:"GET",
    headers:{ "xi-api-key":ELEVENLABS_API_KEY, "Accept":"application/json" }
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data?.detail?.message || data?.detail || data?.message || data?.error || `elevenlabs_${r.status}`);
  return data;
}
async function listElevenVoices(){
  const voices = [];
  const seen = new Set();
  let token = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ page_size:"100", sort:"name", sort_direction:"asc", include_total_count:"false" });
    if (token) params.set("next_page_token", token);
    const data = await getElevenJson(`/v2/voices?${params.toString()}`);
    const pageVoices = Array.isArray(data.voices) ? data.voices : [];
    for (const voice of pageVoices) {
      const id = String(voice.voice_id || "").trim();
      const name = String(voice.name || "").trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      voices.push({
        label:name,
        value:id,
        preview_url:String(voice.preview_url || voice.sharing?.preview_url || "").trim(),
        category:String(voice.category || voice.sharing?.category || "").trim(),
        description:String(voice.description || voice.sharing?.description || "").trim()
      });
    }
    if (!data.has_more || !data.next_page_token) break;
    token = String(data.next_page_token || "");
  }
  voices.sort((a,b)=>a.label.localeCompare(b.label));
  return voices;
}
async function postElevenJsonAudio(path, payload){
  const r = await fetch(ELEVENLABS_BASE + path, {
    method:"POST",
    headers:{ "xi-api-key":ELEVENLABS_API_KEY, "Content-Type":"application/json", "Accept":"audio/mpeg" },
    body:JSON.stringify(payload)
  });
  return await elevenAudioResponse(r);
}
async function postElevenMultipartAudio(path, source, fields){
  const form = new FormData();
  const blob = new Blob([source.bytes], { type:source.contentType || "audio/mpeg" });
  form.append("audio", blob, source.fileName || "audio.mp3");
  for (const [key, value] of Object.entries(fields || {})) {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  }
  const r = await fetch(ELEVENLABS_BASE + path, {
    method:"POST",
    headers:{ "xi-api-key":ELEVENLABS_API_KEY, "Accept":"audio/mpeg" },
    body:form
  });
  return await elevenAudioResponse(r);
}
async function elevenAudioResponse(r){
  const contentType = r.headers.get("content-type") || "audio/mpeg";
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!r.ok) {
    let message = `elevenlabs_${r.status}`;
    if (/json|text/i.test(contentType)) {
      const text = bytes.toString("utf8");
      try {
        const json = JSON.parse(text);
        message = json?.detail?.message || json?.detail || json?.message || json?.error || message;
      } catch {
        message = text.slice(0,240) || message;
      }
    }
    throw new Error(String(message));
  }
  if (!bytes.length) throw new Error("elevenlabs_empty_audio");
  return { bytes, contentType };
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
function guessMimeFromName(name){
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "audio/mpeg";
}
async function storeGeneratedAudio({ uid, run_id, kind, bytes, contentType, fileName }){
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("missing_supabase_storage_env");
  const safeName = sanitizeFileName(fileName || "audio.mp3");
  const objectPath = `audio/generated/${encodeURIComponent(uid).replace(/%/g,"")}/${encodeURIComponent(run_id).replace(/%/g,"")}/${Date.now()}-${safeName}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${objectPath}`;
  const r = await fetch(uploadUrl, {
    method:"POST",
    headers:{ ...sb(), "Content-Type":contentType || "audio/mpeg", "x-upsert":"true" },
    body:bytes
  });
  if (!r.ok) {
    const text = await r.text().catch(()=>"");
    throw new Error(`supabase_audio_upload_failed${text ? `: ${text.slice(0,180)}` : ""}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${objectPath}`;
}
async function markDirectReady(uid, run_id, { kind, provider, cost, resultUrl, request }){
  const meta = {
    ...(await readGenerationMeta(uid, run_id) || {}),
    run_id,
    status:"ready",
    failed:false,
    error:null,
    task_id:run_id,
    audio_kind:kind,
    provider,
    title:provider,
    audio_url:resultUrl,
    audio_urls:[resultUrl],
    completed_at:new Date().toISOString(),
    estimated_cost:cost,
    refund_amount:cost,
    request
  };
  const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
  await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ result_url:resultUrl, provider, meta }) });
}
async function uploadBase64(base64Data, fileName){
  const r = await fetch(KIE_BASE64_UPLOAD_URL, { method:"POST", headers:{ "Authorization":`Bearer ${API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify({ base64Data, uploadPath:"audio/hansora", fileName }) });
  const data = await r.json().catch(()=>({}));
  if (!r.ok || !(data && data.data)) throw new Error("kie_upload_failed");
  return data.data;
}
async function verifyUser(token){
  try{
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const r = await fetch(AUTH_USER_URL, { headers:{ "apikey":SERVICE_KEY, "Authorization":"Bearer " + token } });
    if (!r.ok) return "";
    const j = await r.json().catch(()=>null);
    return j && j.id ? String(j.id) : "";
  } catch { return ""; }
}
async function seedPlaceholder(uid, run_id, { kind, prompt, cost, title }){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    const existing = await getExistingTask(uid, run_id);
    if (existing) return;
    await fetch(UG_URL, { method:"POST", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ user_id:uid, provider:title, kind:"audio", prompt, result_url:null, meta:{ run_id, status:"processing", audio_kind:kind, charged:false, estimated_cost:cost, refund_amount:cost, title } }) });
  } catch(e){ console.warn("[run-audio] placeholder write failed", e); }
}
async function patchTaskMeta(uid, run_id, extraMeta){
  try{
    if (!UG_URL || !SERVICE_KEY) return;
    const q = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}`;
    const current = await readGenerationMeta(uid, run_id);
    const nextMeta = { ...(current || {}), run_id, ...extraMeta };
    await fetch(UG_URL + q, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ meta:nextMeta }) });
  } catch {}
}
async function readGenerationMeta(uid, run_id){
  try{
    if (!UG_URL) return null;
    const q = `?select=meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers:sb() });
    const arr = await r.json().catch(()=>[]);
    return Array.isArray(arr) && arr[0] ? (arr[0].meta || {}) : null;
  } catch { return null; }
}
async function getCredits(uid){
  try{
    if (!PROFILES_URL) return 0;
    const r = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}`, { headers:sb() });
    const arr = await r.json().catch(()=>[]);
    const c = Array.isArray(arr) && arr.length ? Number(arr[0].credits || 0) : 0;
    return Number.isFinite(c) ? c : 0;
  } catch { return 0; }
}
async function debitCredits(uid, cost){
  try{
    if (!PROFILES_URL) return false;
    const cur = await getCredits(uid);
    if (cur < cost) return false;
    const next = Math.round((cur - cost) * 10) / 10;
    const r = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ credits:next }) });
    return r.ok;
  } catch { return false; }
}
async function refundCredits(uid, cost){
  try{
    if (!PROFILES_URL) return false;
    const cur = await getCredits(uid);
    const next = Math.round((cur + Number(cost || 0)) * 100) / 100;
    const r = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, { method:"PATCH", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ credits:next }) });
    return r.ok;
  } catch { return false; }
}
async function getExistingTask(uid, run_id){
  try{
    if (!UG_URL) return null;
    const q = `?select=id,result_url,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers:sb() });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length) {
      const meta = arr[0].meta || {};
      const taskId = meta.task_id || meta.taskId || "";
      return { id:arr[0].id, taskId:taskId ? String(taskId) : "", resultUrl:arr[0].result_url || meta.audio_url || "" };
    }
    return null;
  } catch { return null; }
}
async function isCharged(uid, run_id){
  const meta = await readGenerationMeta(uid, run_id);
  return !!(meta && (meta.charged === true || meta.charged === "true"));
}
async function markCharged(uid, run_id, cost, taskId){
  await patchTaskMeta(uid, run_id, { charged:true, charged_cost:cost, refund_amount:cost, task_id:taskId });
}
function extractTaskId(data){
  if (!data || typeof data !== "object") return "";
  if (data?.data?.taskId) return String(data.data.taskId);
  if (data?.data?.task_id) return String(data.data.task_id);
  if (data?.taskId) return String(data.taskId);
  if (data?.task_id) return String(data.task_id);
  if (data?.result?.taskId) return String(data.result.taskId);
  const seen = new Set();
  function scan(x){
    if (!x || typeof x !== "object" || seen.has(x)) return "";
    seen.add(x);
    for (const [k,v] of Object.entries(x)){
      if (/^(task[_-]?id|request[_-]?id|record[_-]?id)$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
        const s = String(v); if (s.length > 3) return s;
      }
      const inner = scan(v); if (inner) return inner;
    }
    return "";
  }
  return scan(data) || "";
}
