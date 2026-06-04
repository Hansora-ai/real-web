// netlify/functions/video-prompt-builder-worker-background.js
// Background worker: calls KIE Claude Opus 4.8 and writes the final text to Supabase.

const KIE_URL = process.env.KIE_CLAUDE_URL || "https://api.kie.ai/claude/v1/messages";
const KIE_KEY = process.env.KIE_API_KEY || process.env.KIEAI_API_KEY || "";
const MAX_TOKENS = Number(process.env.KIE_CLAUDE_MAX_TOKENS || 8192);
const WORKER_SECRET = process.env.VIDEO_PROMPT_WORKER_SECRET || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UG_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/user_generations` : "";
const PROFILES_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/profiles` : "";

const MODEL = "claude-opus-4-8";
const VERSION_TAG = "video_prompt_builder_claude_opus_4_8_worker_v1";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(body) };
}

function header(event, key) {
  return event.headers?.[key] || event.headers?.[key.toLowerCase()] || event.headers?.[key.toUpperCase()] || "";
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

async function fetchGeneration(rowId, uid, runId) {
  if (!UG_URL || !SERVICE_KEY) return null;
  const select = "select=id,user_id,meta,prompt,result_url,created_at";
  const queries = [];
  if (rowId) queries.push(`?id=eq.${encodeURIComponent(rowId)}&${select}&limit=1`);
  if (uid && runId) queries.push(`?user_id=eq.${encodeURIComponent(uid)}&meta->>run_id=eq.${encodeURIComponent(runId)}&${select}&limit=1`);

  for (const query of queries) {
    const response = await fetch(UG_URL + query, { headers: sbHeaders() });
    const rows = await response.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) return row;
  }
  return null;
}

async function patchGeneration(id, payload) {
  if (!UG_URL || !SERVICE_KEY || !id) return false;
  const response = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(payload)
  });
  return response.ok;
}

function collectClaudeText(value) {
  const parts = [];

  function push(text) {
    const cleaned = String(text || "").trim();
    if (cleaned) parts.push(cleaned);
  }

  function walk(x, depth = 0, trusted = false) {
    if (!x || depth > 10) return;
    if (typeof x === "string") {
      const parsed = safeJson(x);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
        walk(parsed, depth + 1, trusted);
        return;
      }
      if (trusted) push(x);
      return;
    }
    if (Array.isArray(x)) {
      for (const item of x) walk(item, depth + 1, trusted);
      return;
    }
    if (typeof x !== "object") return;

    if ((x.type === "text" || x.type === "output_text") && typeof x.text === "string") push(x.text);
    if (typeof x.text === "string" && trusted) push(x.text);
    if (typeof x.content === "string" && trusted) push(x.content);

    for (const key of ["content", "message", "data", "result", "results", "output", "outputs", "response", "completion"]) {
      if (x[key] != null) walk(x[key], depth + 1, trusted || key === "content" || key === "completion");
    }
  }

  walk(value);
  return parts.join("\n").trim();
}

async function callKieClaude(prompt) {
  const response = await fetch(KIE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KIE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      thinkingFlag: true,
      stream: false,
      max_tokens: MAX_TOKENS
    })
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    data = { raw };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, error: data?.msg || data?.message || data?.error || raw || "kie_http_failed", raw: data };
  }

  const text = collectClaudeText(data);
  if (!text) {
    return { ok: false, status: response.status, error: data?.msg || data?.message || "missing_claude_text", raw: data };
  }

  return { ok: true, status: response.status, text, raw: data };
}

async function refundOnce(row, amount, reason) {
  if (!row || !PROFILES_URL || !Number.isFinite(amount) || amount <= 0) return { refunded: false, amount: 0 };
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  if (String(meta.refunded || "").toLowerCase() === "true") return { refunded: false, already_refunded: true, amount };

  const claim = `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const claimMeta = {
    ...meta,
    status: "failed",
    failed: true,
    error: reason,
    refund_claim: claim,
    failed_at: new Date().toISOString()
  };

  const claimResponse = await fetch(`${UG_URL}?id=eq.${encodeURIComponent(row.id)}&meta->>refunded=is.null&meta->>refund_claim=is.null&select=id`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ meta: claimMeta })
  });
  const claimed = await claimResponse.json().catch(() => []);
  if (!claimResponse.ok || !Array.isArray(claimed) || !claimed.length) return { refunded: false, amount, already_claimed: true };

  const profileResponse = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}&select=credits&limit=1`, {
    headers: sbHeaders()
  });
  const profiles = await profileResponse.json().catch(() => []);
  const currentCredits = Number(Array.isArray(profiles) && profiles[0] ? profiles[0].credits : 0);
  const nextCredits = Math.round((currentCredits + amount) * 100) / 100;
  const updateResponse = await fetch(`${PROFILES_URL}?user_id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
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

async function markDone(row, runId, result) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  await patchGeneration(row.id, {
    result_url: null,
    meta: {
      ...meta,
      source: "video-prompt-builder",
      run_id: runId || meta.run_id || "",
      model: MODEL,
      status: "done",
      result_text: result.text,
      raw_result: result.raw,
      completed_at: new Date().toISOString()
    }
  });
}

async function markFailed(row, runId, reason, raw) {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  await patchGeneration(row.id, {
    result_url: null,
    meta: {
      ...meta,
      source: "video-prompt-builder",
      run_id: runId || meta.run_id || "",
      model: MODEL,
      status: "failed",
      failed: true,
      error: reason,
      raw_error: raw || null,
      failed_at: new Date().toISOString()
    }
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method_not_allowed", version: VERSION_TAG });
  if (WORKER_SECRET && header(event, "x-worker-secret") !== WORKER_SECRET) {
    return json(401, { ok: false, error: "unauthorized", version: VERSION_TAG });
  }

  const body = safeJson(event.body);
  const uid = String(body.uid || "").trim();
  const runId = String(body.run_id || body.runId || "").trim();
  const rowId = String(body.row_id || body.rowId || "").trim();
  const prompt = String(body.prompt || "").trim();
  const cost = Number(body.cost || 1);

  if (!KIE_KEY) return json(500, { ok: false, error: "missing_kie_key", version: VERSION_TAG });
  if (!prompt || !uid || !runId) return json(400, { ok: false, error: "missing_payload", version: VERSION_TAG });

  const row = await fetchGeneration(rowId, uid, runId);
  if (!row) return json(404, { ok: false, error: "generation_row_not_found", version: VERSION_TAG });

  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  if (meta.status === "done" && meta.result_text) return json(200, { ok: true, status: "already_done", version: VERSION_TAG });
  if (meta.status === "failed") return json(200, { ok: true, status: "already_failed", version: VERSION_TAG });

  await patchGeneration(row.id, {
    meta: {
      ...meta,
      source: "video-prompt-builder",
      run_id: runId,
      model: MODEL,
      status: "processing",
      worker_started_at: new Date().toISOString(),
      refund_amount: Number.isFinite(cost) && cost > 0 ? cost : 1
    }
  });

  const result = await callKieClaude(prompt);
  if (result.ok) {
    await markDone(row, runId, result);
    return json(200, { ok: true, status: "done", version: VERSION_TAG });
  }

  await markFailed(row, runId, result.error || "kie_failed", result.raw || result);
  await refundOnce(row, Number.isFinite(cost) && cost > 0 ? cost : 1, result.error || "kie_failed");
  return json(200, { ok: false, status: "failed", error: result.error || "kie_failed", version: VERSION_TAG });
};
