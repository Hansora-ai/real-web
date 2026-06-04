// netlify/functions/video-prompt-builder-check.js
// Checker for the video prompt builder. It does not call KIE; it reads the
// Supabase row updated by video-prompt-builder-worker-background.js.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";

const VERSION_TAG = "video_prompt_builder_check_supabase_v1";

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

function sbHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

function safeJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function findGeneration({ uid, runId }) {
  if (!UG_URL || !SERVICE_KEY || !uid || !runId) return null;
  const query = `?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=id,user_id,prompt,result_url,meta,created_at&limit=1`;
  const response = await fetch(UG_URL + query, { headers: sbHeaders() });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function responseFromRow(row) {
  if (!row) return { ok: false, status: "ignored", reason: "not_found", version: VERSION_TAG };
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const status = String(meta.status || "pending").toLowerCase();

  if (status === "done" && meta.result_text) {
    return {
      ok: true,
      status: "done",
      text: meta.result_text,
      result_text: meta.result_text,
      version: VERSION_TAG
    };
  }

  if (status === "failed") {
    return {
      ok: false,
      failed: true,
      status: "failed",
      error: meta.error || "kie_failed",
      refunded: !!meta.refunded,
      refund_amount: Number(meta.refunded_cost || 0),
      version: VERSION_TAG
    };
  }

  return {
    ok: false,
    status: status === "processing" ? "pending" : status || "pending",
    version: VERSION_TAG
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Use GET or POST", version: VERSION_TAG });
    }

    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === "POST" ? safeJson(event.body) : {};
    const uid = String(qs.uid || body.uid || body.user_id || "").trim();
    const runId = String(qs.run_id || qs.runId || body.run_id || body.runId || "").trim();

    const row = await findGeneration({ uid, runId });
    return json(200, responseFromRow(row));
  } catch (error) {
    return json(200, { ok: false, status: "error", error: String(error?.message || error), version: VERSION_TAG });
  }
};
