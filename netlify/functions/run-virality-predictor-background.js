// netlify/functions/run-virality-predictor-background.js
// Background worker: analyze a short video with KIE Gemini 3.1 Pro and save strict virality scores.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const KIE_URL = "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions";
const API_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";
const COST = 0.3;
const MAX_DURATION = 15;

const ANALYSIS_PROMPT_EN = `You are a strict short-form video performance analyst for TikTok, Instagram Reels, and YouTube Shorts.

Your job is NOT to be encouraging. Your job is to predict retention risk and viral potential as honestly as possible.

Analyze the uploaded video deeply. Judge only what is visible and audible in the video. Do not assume the creator has followers, a trend, paid traffic, external context, or platform favoritism.

Be harsh with scores:
- 90-100 = exceptional, immediately scroll-stopping, very rare
- 75-89 = strong, likely to perform well
- 55-74 = average/good but with clear weaknesses
- 35-54 = weak, needs major improvement
- 0-34 = poor, unlikely to hold attention

Hard caps:
- If the video has no clear story, no strong movement, weak audio, no text hook, unclear subject, or static pacing, viral_potential must be below 55.
- If hold_rate is below 40, viral_potential must not exceed 55.
- If auditory_cortex is below 25 and there is no strong visual storyline, viral_potential must not exceed 60.
- If language_network is below 20 and the video requires context to understand, viral_potential must not exceed 55.
- If focus_drift is above 65, viral_potential must not exceed 50 unless hook_score is above 90 and hold_rate is above 70.

Analyze these dimensions:
1. hook_score: first 1-2 seconds, visual surprise, curiosity, immediate reason to watch.
2. hold_rate: likelihood viewers stay until the end.
3. visual_cortex: composition, motion, clarity, contrast, subject appeal, visual novelty.
4. auditory_cortex: music, voice, rhythm, sound design, emotional audio impact.
5. attention_control: pacing, changes, cuts, movement, novelty over time.
6. focus_drift: risk that viewer attention drops or gets bored. Higher means worse.
7. language_network: captions, text overlays, voiceover, story clarity, semantic hook.
8. viral_potential: final realistic score based on the weighted quality of all categories.

Important:
- Do not give a high viral_potential just because the first frame looks good.
- A strong hook with poor retention should produce a moderate or low final score.
- Static footage should be penalized unless it has exceptional tension, emotion, or story.
- No audio or weak audio should strongly reduce auditory_cortex.
- No text/voice/context should reduce language_network.
- The final score must match the weaknesses you identify.
- Be specific. Mention exact pacing, visible scene changes, text/audio/story problems, and drop-off risks.

Return ONLY valid JSON with this exact schema:
{
  "viral_potential": number,
  "hook_score": number,
  "hold_rate": number,
  "visual_cortex": number,
  "auditory_cortex": number,
  "attention_control": number,
  "focus_drift": number,
  "language_network": number,
  "score_reasoning": {
    "viral_potential": "why this exact score is justified",
    "hook_score": "specific evidence from first 1-2 seconds",
    "hold_rate": "specific retention risks or strengths",
    "visual_cortex": "specific visual evidence",
    "auditory_cortex": "specific audio evidence",
    "attention_control": "specific pacing/movement evidence",
    "focus_drift": "specific boredom/drop-off evidence",
    "language_network": "specific text/story/context evidence"
  },
  "top_issues": [
    "specific issue 1",
    "specific issue 2",
    "specific issue 3",
    "specific issue 4"
  ],
  "improvements": [
    "specific actionable improvement 1",
    "specific actionable improvement 2",
    "specific actionable improvement 3",
    "specific actionable improvement 4"
  ]
`;

const ANALYSIS_PROMPT_RU = `Ты строгий аналитик эффективности коротких видео для TikTok, Instagram Reels и YouTube Shorts.

Твоя задача — НЕ подбадривать автора. Твоя задача — максимально честно предсказать риск падения удержания и вирусный потенциал.

Глубоко проанализируй загруженное видео. Оценивай только то, что видно и слышно в видео. Не предполагай, что у автора есть подписчики, тренд, платный трафик, внешний контекст или преимущество от платформы.

Оценивай строго:
- 90-100 = исключительное видео, моментально останавливает скролл, очень редкий уровень
- 75-89 = сильное видео, вероятно покажет хороший результат
- 55-74 = среднее/хорошее видео, но с явными слабостями
- 35-54 = слабое видео, нужны серьезные улучшения
- 0-34 = плохое видео, скорее всего не удержит внимание

Жесткие ограничения:
- Если в видео нет понятной истории, сильного движения, хорошего аудио, текстового хука, ясного объекта внимания или динамичного темпа, viral_potential должен быть ниже 55.
- Если hold_rate ниже 40, viral_potential не должен превышать 55.
- Если auditory_cortex ниже 25 и нет сильной визуальной истории, viral_potential не должен превышать 60.
- Если language_network ниже 20 и для понимания видео нужен контекст, viral_potential не должен превышать 55.
- Если focus_drift выше 65, viral_potential не должен превышать 50, кроме случая, когда hook_score выше 90 и hold_rate выше 70.

Проанализируй эти параметры:
1. hook_score: первые 1-2 секунды, визуальная неожиданность, любопытство, мгновенная причина смотреть дальше.
2. hold_rate: вероятность, что зрители досмотрят видео до конца.
3. visual_cortex: композиция, движение, четкость, контраст, привлекательность объекта, визуальная новизна.
4. auditory_cortex: музыка, голос, ритм, саунд-дизайн, эмоциональное влияние аудио.
5. attention_control: темп, изменения, монтажные склейки, движение, новизна по ходу видео.
6. focus_drift: риск, что внимание зрителя упадет или ему станет скучно. Чем выше показатель, тем хуже.
7. language_network: субтитры, текстовые надписи, озвучка, ясность истории, смысловой хук.
8. viral_potential: итоговый реалистичный балл на основе взвешенного качества всех категорий.

Важно:
- Не ставь высокий viral_potential только потому, что первый кадр выглядит хорошо.
- Сильный хук при слабом удержании должен давать средний или низкий итоговый балл.
- Статичное видео нужно строго штрафовать, если в нем нет исключительного напряжения, эмоции или истории.
- Отсутствие аудио или слабое аудио должно сильно снижать auditory_cortex.
- Отсутствие текста/голоса/контекста должно снижать language_network.
- Итоговый балл должен совпадать со слабыми местами, которые ты указываешь.
- Будь конкретным. Упоминай точный темп, видимые смены сцен, проблемы текста/аудио/истории и риски ухода зрителей.

Верни ТОЛЬКО валидный JSON с этой точной схемой. Ключи JSON должны оставаться на английском, но все текстовые объяснения, top_issues и improvements должны быть на русском:
{
  "viral_potential": number,
  "hook_score": number,
  "hold_rate": number,
  "visual_cortex": number,
  "auditory_cortex": number,
  "attention_control": number,
  "focus_drift": number,
  "language_network": number,
  "score_reasoning": {
    "viral_potential": "почему именно этот балл оправдан",
    "hook_score": "конкретные доказательства из первых 1-2 секунд",
    "hold_rate": "конкретные риски или сильные стороны удержания",
    "visual_cortex": "конкретные визуальные доказательства",
    "auditory_cortex": "конкретные доказательства по аудио",
    "attention_control": "конкретные доказательства темпа/движения",
    "focus_drift": "конкретные доказательства скуки/риска ухода",
    "language_network": "конкретные доказательства по тексту/истории/контексту"
  },
  "top_issues": [
    "конкретная проблема 1",
    "конкретная проблема 2",
    "конкретная проблема 3",
    "конкретная проблема 4"
  ],
  "improvements": [
    "конкретное практическое улучшение 1",
    "конкретное практическое улучшение 2",
    "конкретное практическое улучшение 3",
    "конкретное практическое улучшение 4"
  ]
}`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });

  let debited = false;
  let uid = "";
  let runId = "";
  let fileName = "";
  let videoUrl = "";
  let duration = 0;
  try {
    const headers = lowerKeys(event.headers || {});
    const body = safeJson(event.body);
    uid = String(body.uid || body.user_id || "").trim();
    videoUrl = normalizeUrl(body.videoUrl || body.video_url || body.url);
    runId = String(body.run_id || body.runId || `${uid}-virality-${Date.now()}`).trim();
    fileName = String(body.fileName || body.file_name || "uploaded-video").trim().slice(0, 180);
    duration = Number(body.duration || body.durationSeconds || 0);
    const language = String(body.language || body.lang || "en").toLowerCase() === "ru" ? "ru" : "en";
    const analysisPrompt = language === "ru" ? ANALYSIS_PROMPT_RU : ANALYSIS_PROMPT_EN;

    if (!API_KEY) return json(200, { ok: false, error: "missing_kie_key" });
    if (!uid) return json(200, { ok: false, error: "missing_uid" });
    if (!videoUrl) return json(200, { ok: false, error: "missing_video_url" });
    if (Number.isFinite(duration) && duration > MAX_DURATION + 0.25) return json(200, { ok: false, error: "video_too_long", max_duration: MAX_DURATION });

    const token = String(headers.authorization || "").toLowerCase().startsWith("bearer ")
      ? String(headers.authorization || "").slice(7).trim()
      : "";
    if (!token) return json(200, { ok: false, error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return json(200, { ok: false, error: "auth_mismatch" });

    const credits = await getCredits(uid);
    if (credits < COST) return json(200, { ok: false, error: "not_enough_credits", cost: COST, credits });
    debited = await updateCredits(uid, -COST);
    if (!debited) return json(200, { ok: false, error: "debit_failed" });
    await saveProcessingGeneration({ uid, runId, fileName, videoUrl, duration, language });

    const kiePayload = {
      model: "gemini-3.1-pro",
      stream: false,
      include_thoughts: false,
      reasoning_effort: "high",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            { type: "image_url", image_url: { url: videoUrl } }
          ]
        }
      ]
    };

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload)
    });
    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`kie_${resp.status}`);
    if (raw && typeof raw === "object" && raw.code && Number(raw.code) !== 200) throw new Error(raw.msg || "kie_failed");

    const content = extractMessageContent(raw);
    const analysis = normalizeAnalysis(parseJsonFromText(content));
    analysis.viral_potential = calculateViralPotential(analysis);
    analysis.cost = COST;
    analysis.model = "gemini-3.1-pro";

    await patchGenerationDone({
      uid,
      runId,
      fileName,
      videoUrl,
      duration,
      language,
      analysis,
      raw
    });

    return json(200, { ok: true, run_id: runId, cost: COST, analysis });
  } catch (error) {
    if (debited && uid) await updateCredits(uid, COST);
    if (uid && runId) {
      await patchGenerationFailed({
        uid,
        runId,
        fileName,
        videoUrl,
        duration,
        language,
        error: messageOf(error) || "analysis_failed",
        refunded: !!debited
      });
    }
    return json(200, {
      ok: false,
      error: messageOf(error) || "analysis_failed",
      refunded: !!debited,
      refund_amount: debited ? COST : 0
    });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: statusCode === 204 ? "" : JSON.stringify(body) };
}
function safeJson(raw) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
function lowerKeys(h) { const out = {}; for (const k in h) out[k.toLowerCase()] = h[k]; return out; }
function normalizeUrl(value) { try { return new URL(String(value || "")).href; } catch { return ""; } }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }
function clamp(n, min = 0, max = 100) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function verifyUser(token) {
  try {
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const res = await fetch(AUTH_USER_URL, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
}

async function getCredits(uid) {
  try {
    const res = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: sb() });
    const arr = await res.json().catch(() => []);
    const credits = Number(Array.isArray(arr) && arr[0] ? arr[0].credits : 0);
    return Number.isFinite(credits) ? credits : 0;
  } catch { return 0; }
}

async function updateCredits(uid, delta) {
  const current = await getCredits(uid);
  const next = Math.round((current + Number(delta || 0)) * 100) / 100;
  if (next < 0) return false;
  const res = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ credits: next })
  });
  return res.ok;
}

async function saveProcessingGeneration({ uid, runId, fileName, videoUrl, duration, language }) {
  if (!UG_URL || !SERVICE_KEY) return;
  const existing = await fetch(`${UG_URL}?select=id&user_id=eq.${encodeURIComponent(uid)}&kind=eq.virality_predictor&meta->>run_id=eq.${encodeURIComponent(runId)}&limit=1`, { headers: sb() });
  const arr = await existing.json().catch(() => []);
  if (Array.isArray(arr) && arr.length) return;
  const payload = {
    user_id: uid,
    provider: "gemini-3.1-pro",
    kind: "virality_predictor",
    prompt: "viral potential predictor",
    result_url: null,
    meta: {
      run_id: runId,
      status: "processing",
      media_type: "video",
      file_name: fileName,
      input_url: videoUrl,
      duration,
      language,
      cost: COST,
      charged: true,
      started_at: new Date().toISOString()
    }
  };
  await fetch(UG_URL, {
    method: "POST",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
}

async function patchGenerationDone({ uid, runId, fileName, videoUrl, duration, language, analysis, raw }) {
  if (!UG_URL || !SERVICE_KEY) return;
  const meta = {
    run_id: runId,
    status: "done",
    media_type: "video",
    file_name: fileName,
    input_url: videoUrl,
    duration,
    language,
    cost: COST,
    charged: true,
    analysis,
    raw_id: raw && raw.id ? raw.id : "",
    completed_at: new Date().toISOString()
  };
  await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&kind=eq.virality_predictor&meta->>run_id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: videoUrl, meta })
  });
}

async function patchGenerationFailed({ uid, runId, fileName, videoUrl, duration, language, error, refunded }) {
  if (!UG_URL || !SERVICE_KEY) return;
  const meta = {
    run_id: runId,
    status: "failed",
    failed: true,
    error,
    media_type: "video",
    file_name: fileName,
    input_url: videoUrl,
    duration,
    language,
    cost: COST,
    charged: true,
    refunded: !!refunded,
    refunded_cost: refunded ? COST : 0,
    failed_at: new Date().toISOString()
  };
  await fetch(`${UG_URL}?user_id=eq.${encodeURIComponent(uid)}&kind=eq.virality_predictor&meta->>run_id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: null, meta })
  });
}

function extractMessageContent(raw) {
  const content = raw?.choices?.[0]?.message?.content ?? raw?.data?.choices?.[0]?.message?.content ?? raw?.content ?? "";
  if (Array.isArray(content)) return content.map(part => part.text || part.content || "").join("\n");
  return String(content || "");
}

function parseJsonFromText(text) {
  const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("invalid_model_json");
}

function normalizeAnalysis(input) {
  const a = input && typeof input === "object" ? input : {};
  const reasoning = a.score_reasoning && typeof a.score_reasoning === "object" ? a.score_reasoning : {};
  return {
    viral_potential: clamp(a.viral_potential),
    hook_score: clamp(a.hook_score),
    hold_rate: clamp(a.hold_rate),
    visual_cortex: clamp(a.visual_cortex),
    auditory_cortex: clamp(a.auditory_cortex),
    attention_control: clamp(a.attention_control),
    focus_drift: clamp(a.focus_drift),
    language_network: clamp(a.language_network),
    score_reasoning: {
      viral_potential: String(reasoning.viral_potential || ""),
      hook_score: String(reasoning.hook_score || ""),
      hold_rate: String(reasoning.hold_rate || ""),
      visual_cortex: String(reasoning.visual_cortex || ""),
      auditory_cortex: String(reasoning.auditory_cortex || ""),
      attention_control: String(reasoning.attention_control || ""),
      focus_drift: String(reasoning.focus_drift || ""),
      language_network: String(reasoning.language_network || "")
    },
    top_issues: normalizeStringList(a.top_issues).slice(0, 4),
    improvements: normalizeStringList(a.improvements).slice(0, 4)
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(x => String(x || "").trim()).filter(Boolean);
}

function calculateViralPotential(a) {
  let raw =
    a.hook_score * 0.22 +
    a.hold_rate * 0.24 +
    a.visual_cortex * 0.14 +
    a.auditory_cortex * 0.08 +
    a.attention_control * 0.18 +
    a.language_network * 0.08 -
    a.focus_drift * 0.10 +
    8;

  let score = clamp(raw);
  if (a.hold_rate < 40) score = Math.min(score, 55);
  if (a.auditory_cortex < 25 && a.visual_cortex < 75) score = Math.min(score, 60);
  if (a.language_network < 20 && a.attention_control < 55) score = Math.min(score, 55);
  if (a.focus_drift > 65 && !(a.hook_score > 90 && a.hold_rate > 70)) score = Math.min(score, 50);
  return clamp(score);
}
