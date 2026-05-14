// netlify/functions/run-audio.js
// Submit Hansora audio jobs to KIE and seed user_generations placeholders.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opt: SITE_BASE (default https://webhansora.netlify.app)

const API_KEY = process.env.KIE_API_KEY || "";
const MARKET_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const SUNO_GENERATE_URL = "https://api.kie.ai/api/v1/generate";
const KIE_BASE64_UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";

const SUPABASE_URL  = (process.env.SUPABASE_URL || "").replace(/\/+$/,"");
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL        = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

const SITE_BASE = (process.env.SITE_BASE || "https://webhansora.netlify.app").replace(/\/+$/,"");
const CALLBACK_BASE = `${SITE_BASE}/.netlify/functions/audio-kie-callback`;


exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return err(405, "Use POST");

  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);
    const uid = (body.uid || body.user_id || "").toString().trim();
    if (!uid) return ok({ submitted:false, error:"missing_uid" });

    const authz = (headers["authorization"] || "").toString();
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return ok({ submitted:false, error:"missing_auth" });

    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return ok({ submitted:false, error:"auth_mismatch" });

    const kind = normalizeKind(body.kind || "voice");
    const cost = calculateCost(kind, body);
    const clientRunId = (body.run_id || body.runId || "").toString().trim();
    const run_id = clientRunId || `${uid}-audio-${Date.now()}`;
    const existing = await getExistingTask(uid, run_id);
    if (existing && existing.taskId) return ok({ submitted:true, run_id, taskId:existing.taskId, already:true });

    const charged = await isCharged(uid, run_id);
    if (!charged) {
      const available = await getCredits(uid);
      if (available < cost) return ok({ submitted:false, error:"not_enough_credits", run_id });
    }

    const prompt = buildPromptForRow(kind, body);
    await seedPlaceholder(uid, run_id, { kind, prompt, cost, title: providerTitle(kind) });

    const callBackUrl = `${CALLBACK_BASE}?uid=${encodeURIComponent(uid)}&run_id=${encodeURIComponent(run_id)}&kind=${encodeURIComponent(kind)}`;
    let resp;
    let kiePayload;

    if (kind === "voice") {
      const dialogue = normalizeDialogue(body.dialogue);
      if (!dialogue.length) return ok({ submitted:false, error:"empty_dialogue", run_id });
      const stability = clampNumber(body.stability, 0, 1, 0.5);
      kiePayload = {
        model: "elevenlabs/text-to-dialogue-v3",
        callBackUrl,
        input: { dialogue, stability }
      };
      resp = await postJson(MARKET_TASK_URL, kiePayload);
    } else if (kind === "isolation") {
      let audioUrl = normalizeUrl(body.audio_url || body.audioUrl || "");
      if (!audioUrl) {
        const fileBase64 = String(body.fileBase64 || body.base64Data || "");
        if (!fileBase64) return ok({ submitted:false, error:"missing_audio_file", run_id });
        const fileName = sanitizeFileName(body.fileName || `audio-${Date.now()}.mp3`);
        const upload = await uploadBase64(fileBase64, fileName);
        audioUrl = normalizeUrl(upload.downloadUrl || upload.fileUrl || upload.url || "");
      }
      if (!audioUrl) return ok({ submitted:false, error:"upload_failed", run_id });
      kiePayload = {
        model: "elevenlabs/audio-isolation",
        callBackUrl,
        input: { audio_url: audioUrl }
      };
      resp = await postJson(MARKET_TASK_URL, kiePayload);
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
    const taskId = extractTaskId(data);
    if (!resp.ok) return ok({ submitted:false, error:`kie_${resp.status}`, data, run_id });
    if (!taskId) return ok({ submitted:false, error:"missing_taskId", data, run_id });

    if (!charged) {
      const debited = await debitCredits(uid, cost);
      if (!debited) return ok({ submitted:false, error:"debit_failed", run_id, taskId });
      await markCharged(uid, run_id, cost, taskId);
    }

    await patchTaskMeta(uid, run_id, { status:"processing", task_id:taskId, kind, provider:providerTitle(kind), cost, request:stripLargeFields(kiePayload) });
    return ok({ submitted:true, run_id, taskId, status:resp.status, data });
  } catch (e) {
    return ok({ submitted:false, error:String(e && e.message ? e.message : e) });
  }
};

function ok(obj){ return { statusCode:200, headers:cors(), body:JSON.stringify(obj) }; }
function err(code, message){ return { statusCode:code, headers:cors(), body:JSON.stringify({ submitted:false, error:message }) }; }
function cors(){ return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, X-USER-ID" }; }
function safeJson(s){ try { return JSON.parse(s || "{}"); } catch { return {}; } }
function lowerKeys(h){ const o={}; for (const k in h) o[k.toLowerCase()] = h[k]; return o; }
function sb(){ return { "apikey":SERVICE_KEY, "Authorization":`Bearer ${SERVICE_KEY}` }; }
function normalizeKind(k){ const s=String(k||"").toLowerCase(); if (["voice","isolation","music"].includes(s)) return s; return "voice"; }
function providerTitle(kind){ return kind === "music" ? "Suno Music" : kind === "isolation" ? "Voice Isolation" : "Text to Voice"; }
function normalizeUrl(u){ try { const url = new URL(String(u || "")); return url.href; } catch { return ""; } }
function clampNumber(value, min, max, fallback){ const n=Number(value); if (!Number.isFinite(n)) return fallback; return Math.max(min, Math.min(max, n)); }
function sanitizeFileName(name){ return String(name || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,90) || "audio.mp3"; }

function calculateCost(kind, body){
  if (kind === "music") return 1.5;
  if (kind === "isolation") {
    const seconds = clampNumber(body.durationSeconds || body.duration || body.audioDurationSeconds, 0, 86400, 0);
    if (!seconds) return 1;
    return Math.max(0.5, Math.ceil((seconds / 60) * 2) / 2);
  }
  const chars = normalizeDialogue(body.dialogue).reduce((sum, item)=>sum + String(item.text || "").length, 0);
  return Math.max(1, Math.ceil(Math.max(chars, 1) / 1000));
}

function normalizeDialogue(input){
  const arr = Array.isArray(input) ? input : [];
  return arr.map((item)=>({ text:String(item && item.text || "").trim(), voice:String(item && item.voice || "Rachel").trim() || "Rachel" })).filter((item)=>item.text);
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
    title:String(body.title || "").trim().slice(0,80)
  };
  if (!instrumental || prompt) payload.prompt = prompt;
  const negativeTags = String(body.negativeTags || "").trim();
  const vocalGender = String(body.vocalGender || "").trim().toLowerCase();
  const personaId = String(body.personaId || "").trim();
  const personaModel = String(body.personaModel || "").trim();
  if (negativeTags) payload.negativeTags = negativeTags.slice(0,500);
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
    await fetch(UG_URL, { method:"POST", headers:{ ...sb(), "Content-Type":"application/json", "Prefer":"return=minimal" }, body:JSON.stringify({ user_id:uid, provider:title, kind:"audio", prompt, result_url:null, meta:{ run_id, status:"processing", audio_kind:kind, charged:false, estimated_cost:cost, title } }) });
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
async function getExistingTask(uid, run_id){
  try{
    if (!UG_URL) return null;
    const q = `?select=id,meta&user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(run_id)}&limit=1`;
    const r = await fetch(UG_URL + q, { headers:sb() });
    if (!r.ok) return null;
    const arr = await r.json().catch(()=>[]);
    if (Array.isArray(arr) && arr.length) {
      const meta = arr[0].meta || {};
      const taskId = meta.task_id || meta.taskId || "";
      return { id:arr[0].id, taskId:taskId ? String(taskId) : "" };
    }
    return null;
  } catch { return null; }
}
async function isCharged(uid, run_id){
  const meta = await readGenerationMeta(uid, run_id);
  return !!(meta && (meta.charged === true || meta.charged === "true"));
}
async function markCharged(uid, run_id, cost, taskId){
  await patchTaskMeta(uid, run_id, { charged:true, charged_cost:cost, task_id:taskId });
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
