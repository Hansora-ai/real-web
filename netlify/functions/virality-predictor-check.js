// netlify/functions/virality-predictor-check.js
// Poll saved virality predictor results from Supabase.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  try {
    const headers = lowerKeys(event.headers || {});
    const qs = event.queryStringParameters || {};
    const uid = String(qs.uid || "").trim();
    const runId = String(qs.run_id || qs.runId || "").trim();
    if (!uid || !runId) return json(200, { ok: false, status: "pending", error: "missing_ids" });

    const token = String(headers.authorization || "").toLowerCase().startsWith("bearer ")
      ? String(headers.authorization || "").slice(7).trim()
      : "";
    if (!token) return json(200, { ok: false, status: "error", error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return json(200, { ok: false, status: "error", error: "auth_mismatch" });

    const row = await findGeneration(uid, runId);
    if (!row) return json(200, { ok: false, status: "pending" });
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const status = String(meta.status || "").toLowerCase();

    if (status === "done" && meta.analysis) {
      return json(200, {
        ok: true,
        status: "done",
        result_url: row.result_url || meta.input_url || "",
        analysis: meta.analysis
      });
    }

    if (status === "failed" || meta.failed) {
      return json(200, {
        ok: false,
        status: "failed",
        error: meta.error || "analysis_failed",
        refunded: !!meta.refunded,
        refund_amount: meta.refunded_cost || 0
      });
    }

    return json(200, { ok: false, status: "pending" });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error) });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-USER-ID",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: statusCode === 204 ? "" : JSON.stringify(body) };
}
function lowerKeys(h) { const out = {}; for (const k in h) out[k.toLowerCase()] = h[k]; return out; }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }

async function verifyUser(token) {
  try {
    if (!AUTH_USER_URL || !SERVICE_KEY) return "";
    const res = await fetch(AUTH_USER_URL, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data && data.id ? String(data.id) : "";
  } catch { return ""; }
}

async function findGeneration(uid, runId) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const query = `?select=id,user_id,result_url,meta,created_at&user_id=eq.${encodeURIComponent(uid)}&kind=eq.virality_predictor&meta->>run_id=eq.${encodeURIComponent(runId)}&limit=1`;
  const res = await fetch(UG_URL + query, { headers: sb() });
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}
