// netlify/functions/translate-virality-analysis.js
// Translate saved virality analysis text between English and Russian without changing scores.
// Env: KIE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const KIE_URL = "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions";
const API_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });

  try {
    if (!API_KEY) return json(200, { ok: false, error: "missing_kie_key" });

    const headers = lowerKeys(event.headers || {});
    const token = String(headers.authorization || "").toLowerCase().startsWith("bearer ")
      ? String(headers.authorization || "").slice(7).trim()
      : "";
    if (!token) return json(200, { ok: false, error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid) return json(200, { ok: false, error: "auth_mismatch" });

    const body = safeJson(event.body);
    const targetLanguage = String(body.target_language || body.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
    const analysis = normalizeAnalysis(body.analysis || {});
    const prompt = buildTranslationPrompt(analysis, targetLanguage);

    const resp = await fetch(KIE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3.1-pro",
        stream: false,
        include_thoughts: false,
        reasoning_effort: "low",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
      })
    });

    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`kie_${resp.status}`);
    if (raw && typeof raw === "object" && raw.code && Number(raw.code) !== 200) throw new Error(raw.msg || "kie_failed");

    const translated = normalizeAnalysis(parseJsonFromText(extractMessageContent(raw)));
    const out = {
      ...analysis,
      score_reasoning: translated.score_reasoning,
      top_issues: translated.top_issues.length ? translated.top_issues : analysis.top_issues,
      improvements: translated.improvements.length ? translated.improvements : analysis.improvements,
      analysis_language: targetLanguage,
      translated_from: analysis.analysis_language || "en"
    };

    return json(200, { ok: true, analysis: out });
  } catch (error) {
    return json(200, { ok: false, error: messageOf(error) || "translation_failed" });
  }
};

function buildTranslationPrompt(analysis, targetLanguage) {
  const targetName = targetLanguage === "ru" ? "Russian" : "English";
  return `Translate ONLY the human-readable text values in this virality analysis JSON to ${targetName}.

Rules:
- Keep all JSON keys exactly the same.
- Keep every numeric score exactly the same.
- Keep the same number of list items.
- Do not add commentary outside JSON.
- Return ONLY valid JSON.
- Translate score_reasoning values, top_issues items, and improvements items.
- Keep cost, model, and any numeric values unchanged.

Input JSON:
${JSON.stringify(analysis, null, 2)}

Return this exact schema:
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
    "viral_potential": "translated text",
    "hook_score": "translated text",
    "hold_rate": "translated text",
    "visual_cortex": "translated text",
    "auditory_cortex": "translated text",
    "attention_control": "translated text",
    "focus_drift": "translated text",
    "language_network": "translated text"
  },
  "top_issues": ["translated item 1", "translated item 2", "translated item 3", "translated item 4"],
  "improvements": ["translated item 1", "translated item 2", "translated item 3", "translated item 4"]
}`;
}

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
    const res = await fetch(AUTH_USER_URL, { headers: { ...sb(), Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
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
  throw new Error("invalid_translation_json");
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
    cost: Number(a.cost || 0),
    model: String(a.model || "gemini-3.1-pro"),
    analysis_language: String(a.analysis_language || a.language || "").toLowerCase().startsWith("ru") ? "ru" : "en",
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
