// netlify/functions/save-generation-inputs.js
// Saves uploaded input URLs into user_generations.meta so Recreate can restore image + prompt.

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });
    if (!UG_URL || !SERVICE_KEY) return json(500, { ok: false, error: "missing_supabase_env" });

    const body = safeJson(event.body);
    const uid = String(body.uid || body.user_id || "").trim();
    const runId = String(body.run_id || body.runId || "").trim();
    if (!uid || !runId) return json(400, { ok: false, error: "missing_uid_or_run_id" });

    const authUid = await uidFromBearer(event);
    if (authUid && authUid !== uid) return json(403, { ok: false, error: "uid_mismatch" });

    const inputUrls = collectInputUrls(body);
    if (!inputUrls.length) return json(400, { ok: false, error: "missing_input_urls" });

    const row = await findGeneration(uid, runId);
    if (!row) return json(200, { ok: false, status: "pending", reason: "generation_row_not_ready" });

    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const existingDiagnostic = meta.client_diagnostic && typeof meta.client_diagnostic === "object" ? meta.client_diagnostic : {};
    const incomingDiagnostic = body.client_diagnostic && typeof body.client_diagnostic === "object" ? body.client_diagnostic : {};
    const modelId = String(body.model_id || incomingDiagnostic.model_id || meta.model || meta.source || "").trim();
    const modelName = String(body.model_name || incomingDiagnostic.model_name || meta.model_name || row.provider || "").trim();
    const taskId = String(body.task_id || body.taskId || meta.task_id || meta.taskId || "").trim();

    const nextMeta = {
      ...meta,
      run_id: runId,
      ...(taskId ? { task_id: taskId } : {}),
      ...(modelId ? { model: modelId } : {}),
      ...(modelName ? { model_name: modelName } : {}),
      input_urls: inputUrls,
      source_urls: inputUrls,
      uploaded_url_count: inputUrls.length,
      input_urls_saved_at: new Date().toISOString(),
      client_diagnostic: {
        ...existingDiagnostic,
        ...incomingDiagnostic,
        ...(modelId ? { model_id: modelId } : {}),
        ...(modelName ? { model_name: modelName } : {}),
        input_urls: inputUrls,
        uploaded_url_count: inputUrls.length
      }
    };

    const res = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ meta: nextMeta })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(200, { ok: false, status: "error", error: text || `supabase_${res.status}` });
    }

    return json(200, { ok: true, status: "saved", input_url_count: inputUrls.length });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: error && error.message ? error.message : String(error) });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) };
}

function sb() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

function safeJson(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function normalizeUrl(url) {
  return String(url || "").replace(/[)"'\\\]}]+$/g, "").trim();
}

function collectInputUrls(body) {
  const urls = [];
  const seen = new Set();
  const candidates = [
    body.input_urls,
    body.inputUrls,
    body.source_urls,
    body.sourceUrls,
    body.urls,
    body.client_diagnostic && body.client_diagnostic.input_urls,
    body.clientDiagnostic && body.clientDiagnostic.input_urls,
    body.meta && body.meta.input_urls,
    body.metadata && body.metadata.input_urls
  ];

  function push(value) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return;
    const clean = normalizeUrl(value);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    urls.push(clean);
  }

  for (const value of candidates) {
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return urls;
}

async function findGeneration(uid, runId) {
  const select = "select=id,user_id,provider,kind,result_url,meta,created_at";
  const query = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&${select}&limit=1`;
  const res = await fetch(UG_URL + query, { headers: sb() });
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) ? (arr[0] || null) : null;
}

async function uidFromBearer(event) {
  const auth = String(event.headers.authorization || event.headers.Authorization || "");
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL) return "";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
  }).catch(() => null);
  if (!res || !res.ok) return "";
  const user = await res.json().catch(() => null);
  return String(user && user.id || "").trim();
}
