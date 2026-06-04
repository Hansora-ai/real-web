// netlify/functions/video-prompt-builder-check.js
// Poll/callback checker for video prompt builder text results from KIE.

const KIE_BASE = (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(body)
  };
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

function extractIds(body = {}) {
  const meta = body?.meta || body?.metadata || body?.data?.meta || body?.data?.metadata || body?.result?.meta || {};
  return {
    uid: String(body?.uid || body?.user_id || body?.data?.uid || meta.uid || "").trim(),
    run_id: String(body?.run_id || body?.runId || body?.data?.run_id || meta.run_id || "").trim(),
    taskId: String(
      body?.taskId ||
      body?.task_id ||
      body?.data?.taskId ||
      body?.data?.task_id ||
      body?.result?.taskId ||
      body?.id ||
      ""
    ).trim()
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
    if (event.httpMethod === "POST") return handlePost(event);
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Use GET or POST" });

    const qs = event.queryStringParameters || {};
    const ids = {
      uid: String(qs.uid || "").trim(),
      run_id: String(qs.run_id || qs.runId || "").trim(),
      taskId: String(qs.taskId || qs.task_id || "").trim()
    };

    const row = await findProcessingGeneration(ids);
    if (!row) return json(200, { ok: false, status: "ignored", reason: "not_processing" });

    ids.uid = ids.uid || row.user_id || "";
    ids.run_id = ids.run_id || row.meta?.run_id || "";
    ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || "";

    if (String(row.meta?.status || "").toLowerCase() === "done" && row.meta?.result_text) {
      return json(200, { ok: true, status: "done", text: row.meta.result_text, result_text: row.meta.result_text });
    }

    if (String(row.meta?.status || "").toLowerCase() === "failed") {
      return json(200, {
        ok: false,
        failed: true,
        status: "failed",
        error: row.meta?.error || "kie_failed",
        refunded: !!row.meta?.refunded,
        refund_amount: Number(row.meta?.refunded_cost || 0)
      });
    }

    if (!ids.taskId) return json(200, { ok: false, status: "pending", error: "missing_task_id" });

    const state = await fetchKieState(ids.taskId);
    if (state.failed) {
      const refund = await failAndRefundOnce({ row, ids, reason: state.error || "kie_failed" });
      return json(200, {
        ok: false,
        failed: true,
        status: "failed",
        error: state.error || "kie_failed",
        refunded: !!refund.refunded,
        refund_amount: refund.amount || 0
      });
    }

    if (state.done && state.text) {
      await markDone({ row, ids, text: state.text, raw: state.raw });
      return json(200, { ok: true, status: "done", text: state.text, result_text: state.text });
    }

    return json(200, { ok: false, status: "pending" });
  } catch (error) {
    return json(200, { ok: false, status: "error", error: messageOf(error) });
  }
};

async function handlePost(event) {
  const qs = event.queryStringParameters || {};
  const body = safeJson(event.body);
  const bodyIds = extractIds(body);
  const ids = {
    uid: String(qs.uid || bodyIds.uid || "").trim(),
    run_id: String(qs.run_id || qs.runId || bodyIds.run_id || "").trim(),
    taskId: String(qs.taskId || qs.task_id || bodyIds.taskId || "").trim()
  };

  const row = await findProcessingGeneration(ids);
  if (!row) return json(200, { ok: false, status: "ignored", reason: "not_processing" });

  ids.uid = ids.uid || row.user_id || "";
  ids.run_id = ids.run_id || row.meta?.run_id || "";
  ids.taskId = ids.taskId || row.meta?.task_id || row.meta?.taskId || "";

  const status = normalizeStatus(body);
  if (status === "failed") {
    const refund = await failAndRefundOnce({ row, ids, reason: failureReason(body) });
    return json(200, {
      ok: false,
      failed: true,
      status: "failed",
      error: failureReason(body),
      refunded: !!refund.refunded,
      refund_amount: refund.amount || 0
    });
  }

  const text = collectResultText(body);
  if (text) {
    await markDone({ row, ids, text, raw: body });
    return json(200, { ok: true, status: "done", text, result_text: text });
  }

  return json(200, { ok: false, status: "pending" });
}

async function findProcessingGeneration(ids) {
  if (!UG_URL || !SERVICE_KEY) return null;

  const select = "select=id,user_id,provider,kind,prompt,result_url,meta,created_at";
  const queries = [];
  if (ids.uid && ids.run_id) {
    queries.push(`?user_id=eq.${encodeURIComponent(ids.uid)}&meta->>run_id=eq.${encodeURIComponent(ids.run_id)}&${select}&limit=1`);
  }
  if (ids.taskId) {
    queries.push(`?meta->>task_id=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
    queries.push(`?meta->>taskId=eq.${encodeURIComponent(ids.taskId)}&${select}&limit=1`);
  }

  for (const query of queries) {
    const response = await fetch(UG_URL + query, { headers: sbHeaders() });
    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) continue;
    const status = String(row.meta?.status || "").toLowerCase();
    if (status === "done" && row.meta?.result_text) return row;
    if (status === "failed") return row;
    if (status === "processing" || status === "pending" || !status) return row;
  }

  return null;
}

async function fetchKieState(taskId) {
  if (!KIE_KEY) return { pending: true, error: "missing_kie_key" };

  const endpoints = [
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/jobs/getTask?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/getTaskResult?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/result?taskId=${encodeURIComponent(taskId)}`,
    `/api/v1/mj/getTask?taskId=${encodeURIComponent(taskId)}`
  ];

  let sawFailed = false;
  let failReason = "";
  for (const path of endpoints) {
    try {
      const response = await fetch(KIE_BASE + path, {
        headers: { Accept: "application/json", Authorization: `Bearer ${KIE_KEY}` }
      });
      const raw = await response.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { raw };
      }

      const status = normalizeStatus(data);
      if (status === "failed") {
        sawFailed = true;
        failReason = failReason || failureReason(data);
        continue;
      }

      const text = collectResultText(data);
      if (text && (status === "done" || status === "pending")) {
        return { done: true, text, raw: data };
      }
    } catch (error) {
      failReason = failReason || messageOf(error);
    }
  }

  if (sawFailed) return { failed: true, error: failReason || "kie_failed" };
  return { pending: true };
}

async function markDone({ row, ids, text, raw }) {
  const meta = {
    ...(row.meta && typeof row.meta === "object" ? row.meta : {}),
    source: "video-prompt-builder",
    run_id: ids.run_id || row.meta?.run_id || "",
    task_id: ids.taskId || row.meta?.task_id || row.meta?.taskId || "",
    status: "done",
    result_text: text,
    raw_result: raw || null,
    completed_at: new Date().toISOString()
  };

  await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify({ result_url: null, meta })
  });
}

async function failAndRefundOnce({ row, ids, reason }) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const amount = Number(meta.refund_amount || 0);
  const failedMeta = {
    ...meta,
    source: "video-prompt-builder",
    run_id: ids.run_id || meta.run_id || "",
    task_id: ids.taskId || meta.task_id || meta.taskId || "",
    status: "failed",
    failed: true,
    error: reason,
    failed_at: new Date().toISOString()
  };

  if (!Number.isFinite(amount) || amount <= 0) {
    await patchGeneration(row.id, { meta: { ...failedMeta, refund_skipped_reason: "missing_refund_amount" } });
    return { refunded: false, amount: 0 };
  }

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = { ...failedMeta, refund_claim: claim };
  const claimUrl = `${UG_URL}?id=eq.${encodeURIComponent(row.id)}&result_url=is.null&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`;
  const claimResponse = await fetch(claimUrl, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }),
    body: JSON.stringify({ result_url: null, meta: claimMeta })
  });
  const claimedRows = await claimResponse.json().catch(() => []);
  if (!claimResponse.ok || !Array.isArray(claimedRows) || !claimedRows.length) {
    return { refunded: false, amount, already_claimed: true };
  }

  const profileResponse = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, {
    headers: sbHeaders()
  });
  const profiles = await profileResponse.json().catch(() => []);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateResponse = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify({ credits: nextCredits })
  });

  if (!updateResponse.ok) {
    await patchGeneration(row.id, { meta: { ...claimMeta, refund_error: "profile_refund_failed" } });
    return { refunded: false, amount, error: "profile_refund_failed" };
  }

  await patchGeneration(row.id, {
    meta: {
      ...claimMeta,
      refunded: true,
      refunded_cost: amount,
      refunded_at: new Date().toISOString()
    }
  });

  return { refunded: true, amount, credits: nextCredits };
}

async function patchGeneration(id, payload) {
  const response = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(payload)
  });
  return response.ok;
}

function normalizeStatus(value) {
  const flag = value?.data?.successFlag ?? value?.successFlag ?? value?.result?.successFlag;
  if (flag === 1 || flag === "1") return "done";
  if (flag === 2 || flag === "2" || flag === 3 || flag === "3") return "failed";

  const text = [];
  collectStatusText(value, text);
  const joined = text.join(" ").toLowerCase();
  if (/(fail|failed|failure|error|errored|cancel|canceled|cancelled|rejected|moderation|blocked|sensitive|flagged)/.test(joined)) return "failed";
  if (/(success|succeeded|completed|complete|finish|finished|done)/.test(joined)) return "done";
  return "pending";
}

function collectStatusText(value, out) {
  if (!value || out.length > 80) return;
  if (typeof value === "string") {
    if (/fail|error|success|complete|finish|done|pending|process|cancel|reject|blocked|moderation|sensitive|flag/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStatusText(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const key of ["status", "state", "message", "error", "reason", "description", "failMsg", "failCode"]) {
      if (value[key] != null) collectStatusText(value[key], out);
    }
    for (const key of ["data", "result", "response", "task", "job"]) {
      if (value[key]) collectStatusText(value[key], out);
    }
  }
}

function failureReason(value) {
  return String(
    value?.error ||
    value?.message ||
    value?.data?.error ||
    value?.data?.message ||
    value?.data?.reason ||
    value?.data?.failMsg ||
    value?.data?.failCode ||
    value?.result?.error ||
    value?.result?.message ||
    "kie_failed"
  );
}

function collectResultText(value) {
  const directKeys = new Set([
    "text",
    "answer",
    "content",
    "completion",
    "output_text",
    "outputText",
    "result_text",
    "resultText",
    "response_text",
    "responseText",
    "generated_prompt",
    "generatedPrompt",
    "final_prompt",
    "finalPrompt"
  ]);
  const containerKeys = new Set([
    "data",
    "result",
    "results",
    "response",
    "output",
    "outputs",
    "task_result",
    "taskResult",
    "result_json",
    "resultJson",
    "response_json",
    "responseJson"
  ]);

  function clean(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    if (/^(pending|processing|success|succeeded|completed|complete|done|ok|true|false|null|undefined)$/i.test(value)) return "";
    if (/^https?:\/\//i.test(value)) return "";
    return value;
  }

  function walk(x, depth = 0, trusted = false) {
    if (!x || depth > 8) return "";
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
        const nested = walk(parsed, depth + 1, trusted);
        if (nested) return nested;
      }
      return trusted ? clean(x) : "";
    }
    if (Array.isArray(x)) {
      for (const item of x) {
        const found = walk(item, depth + 1, trusted);
        if (found) return found;
      }
      return "";
    }
    if (typeof x === "object") {
      for (const [key, child] of Object.entries(x)) {
        if (directKeys.has(key)) {
          const found = walk(child, depth + 1, true);
          if (found) return found;
        }
      }
      for (const [key, child] of Object.entries(x)) {
        if (containerKeys.has(key)) {
          const found = walk(child, depth + 1, true);
          if (found) return found;
        }
      }
    }
    return "";
  }

  return walk(value);
}

function messageOf(error) {
  return String(error?.message || error || "unknown_error");
}
