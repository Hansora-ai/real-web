// netlify/functions/virality-predictor-check.js
// Poll saved virality predictor results from Supabase.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";
const AUTH_USER_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/user` : "";
const MAX_MISSING_ROW_MS = 200000;
const MAX_PROCESSING_MS = 200000;
const VIRALITY_REFUND_AMOUNT = 0.3;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  try {
    const headers = lowerKeys(event.headers || {});
    const qs = event.queryStringParameters || {};
    const uid = String(qs.uid || "").trim();
    const runId = String(qs.run_id || qs.runId || "").trim();
    if (!uid || !runId) return json(200, { ok: false, status: "error", error: "missing_ids" });

    const token = String(headers.authorization || "").toLowerCase().startsWith("bearer ")
      ? String(headers.authorization || "").slice(7).trim()
      : "";
    if (!token) return json(200, { ok: false, status: "error", error: "missing_auth" });
    const authedUid = await verifyUser(token);
    if (!authedUid || authedUid !== uid) return json(200, { ok: false, status: "error", error: "auth_mismatch" });

    const row = await findGeneration(uid, runId);
    if (!row) {
      if (isExpiredRun(runId, MAX_MISSING_ROW_MS)) {
        return json(200, { ok: false, status: "failed", error: "analysis_job_not_recorded", refunded: false, refund_amount: 0 });
      }
      return json(200, { ok: false, status: "pending" });
    }
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const status = normalizeStatus(firstValue(
      meta.status,
      meta.state,
      meta.task_status,
      meta.taskStatus,
      meta.raw && meta.raw.status,
      meta.raw && meta.raw.state,
      meta.raw && meta.raw.data && meta.raw.data.status,
      meta.raw && meta.raw.data && meta.raw.data.state
    ));

    if (isSuccessStatus(status) && meta.analysis) {
      return json(200, {
        ok: true,
        status: "done",
        result_url: row.result_url || meta.input_url || "",
        analysis: meta.analysis
      });
    }

    if (isSuccessStatus(status)) {
      const resultText = extractResultText(meta);
      const refund = await refundFailedAnalysis(uid, row, meta, resultText);
      return json(200, {
        ok: false,
        status: "failed",
        error: isRefusalText(resultText) ? "analysis_refused" : "analysis_missing",
        message: resultText || "",
        refunded: refund.refunded,
        refund_amount: refund.amount
      });
    }

    if (isFailureStatus(status) || meta.failed || meta.refunded || Number(meta.refunded_cost || 0) > 0 || hasError(meta)) {
      const refund = await refundFailedAnalysis(uid, row, meta, getError(meta) || "analysis_failed");
      return json(200, {
        ok: false,
        status: "failed",
        error: getError(meta) || "analysis_failed",
        refunded: refund.refunded,
        refund_amount: refund.amount
      });
    }

    if ((status === "processing" || status === "pending" || !status) && isExpiredRun(runId, MAX_PROCESSING_MS, row.created_at || meta.started_at)) {
      const refund = await refundFailedAnalysis(uid, row, meta, "analysis_timeout");
      return json(200, {
        ok: false,
        status: "failed",
        error: "analysis_timeout",
        refunded: refund.refunded,
        refund_amount: refund.amount
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
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Cache-Control": "no-store, max-age=0"
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: statusCode === 204 ? "" : JSON.stringify(body) };
}
function lowerKeys(h) { const out = {}; for (const k in h) out[k.toLowerCase()] = h[k]; return out; }
function sb() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
function messageOf(error) { return error && error.message ? error.message : String(error); }
function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "");
}
function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}
function isSuccessStatus(status) {
  return ["done", "success", "succeeded", "completed", "complete"].includes(status);
}
function isFailureStatus(status) {
  if (/(^|_)(fail|failed|failure|error|errored|cancel|canceled|cancelled|rejected|moderation|blocked|sensitive|flagged|timeout|timed_out)(_|$)/.test(status)) {
    return true;
  }
  return [
    "fail",
    "failed",
    "failure",
    "error",
    "errored",
    "rejected",
    "cancelled",
    "canceled",
    "timeout",
    "timed_out",
    "create_failed",
    "analysis_failed"
  ].includes(status);
}
function getError(meta) {
  return firstValue(
    meta.error,
    meta.error_message,
    meta.errorMessage,
    meta.message,
    meta.raw && meta.raw.error,
    meta.raw && meta.raw.msg,
    meta.raw && meta.raw.message,
    meta.raw && meta.raw.data && meta.raw.data.error,
    meta.raw && meta.raw.data && meta.raw.data.msg,
    meta.raw && meta.raw.data && meta.raw.data.message
  );
}
function hasError(meta) {
  return !!getError(meta);
}
function extractResultText(meta) {
  return String(firstValue(
    meta.response,
    meta.result,
    meta.output,
    meta.content,
    meta.text,
    meta.message,
    meta.raw && meta.raw.response,
    meta.raw && meta.raw.result,
    meta.raw && meta.raw.output,
    meta.raw && meta.raw.content,
    meta.raw && meta.raw.text,
    meta.raw && meta.raw.message,
    meta.raw && meta.raw.data && meta.raw.data.response,
    meta.raw && meta.raw.data && meta.raw.data.result,
    meta.raw && meta.raw.data && meta.raw.data.output,
    meta.raw && meta.raw.data && meta.raw.data.content,
    meta.raw && meta.raw.data && meta.raw.data.text,
    meta.raw && meta.raw.data && meta.raw.data.message,
    meta.raw && meta.raw.choices && meta.raw.choices[0] && meta.raw.choices[0].message && meta.raw.choices[0].message.content,
    meta.raw && meta.raw.data && meta.raw.data.choices && meta.raw.data.choices[0] && meta.raw.data.choices[0].message && meta.raw.data.choices[0].message.content
  ) || "").trim();
}
function isRefusalText(text) {
  return /\b(i\s+cannot\s+fulfill|i\s+can't\s+fulfill|cannot\s+fulfill\s+this\s+request|unable\s+to\s+fulfill|can't\s+assist|cannot\s+assist|policy)\b/i.test(String(text || ""));
}
function isExpiredRun(runId, maxPendingMs, fallbackDate) {
  const match = String(runId || "").match(/-(\d{13})$/);
  const startedAt = match ? Number(match[1]) : Date.parse(fallbackDate || "");
  return Number.isFinite(startedAt) && Date.now() - startedAt > maxPendingMs;
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
  if (!PROFILES_URL || !SERVICE_KEY) return 0;
  const res = await fetch(`${PROFILES_URL}?select=credits&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: sb() });
  if (!res.ok) return 0;
  const arr = await res.json().catch(() => []);
  const credits = Number(Array.isArray(arr) && arr[0] ? arr[0].credits : 0);
  return Number.isFinite(credits) ? credits : 0;
}

async function updateCredits(uid, delta) {
  if (!PROFILES_URL || !SERVICE_KEY) return false;
  const current = await getCredits(uid);
  const amount = Number(delta || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const next = Math.round((current + amount) * 100) / 100;
  const res = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ credits: next })
  });
  return res.ok;
}

async function refundFailedAnalysis(uid, row, meta, resultText) {
  const existingRefund = Number(meta.refunded_cost || 0);
  if (meta.refunded || existingRefund > 0) {
    return { refunded: true, amount: existingRefund };
  }

  const amount = VIRALITY_REFUND_AMOUNT;

  const refunded = await updateCredits(uid, amount);
  await patchGenerationTerminalFailure(row, meta, resultText, refunded, refunded ? amount : 0);
  return { refunded, amount: refunded ? amount : 0 };
}

async function patchGenerationTerminalFailure(row, meta, resultText, refunded, refundAmount) {
  if (!UG_URL || !SERVICE_KEY || !row || !row.id) return;
  const nextMeta = {
    ...meta,
    status: "failed",
    failed: true,
    error: isRefusalText(resultText) ? "analysis_refused" : "analysis_missing",
    message: resultText || meta.message || "",
    refunded: !!refunded,
    refunded_cost: refundAmount || 0,
    failed_at: new Date().toISOString()
  };
  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: { ...sb(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ result_url: null, meta: nextMeta })
  });
}

async function findGeneration(uid, runId) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const query = `?select=id,user_id,result_url,meta,created_at&user_id=eq.${encodeURIComponent(uid)}&kind=eq.virality_predictor&meta->>run_id=eq.${encodeURIComponent(runId)}&order=created_at.desc&limit=1`;
  const res = await fetch(UG_URL + query, { headers: sb() });
  if (!res.ok) throw new Error(`supabase_${res.status}`);
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}
