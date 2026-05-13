const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sbHeaders() {
  return {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
}

async function refundGenerationOnce({ generationId, reason, source }) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, error: "missing_supabase_env" };
  }
  if (!generationId) {
    return { ok: false, error: "missing_generation_id" };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/refund_generation_once`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify({
      p_generation_id: generationId,
      p_reason: reason || "generation_failed",
      p_source: source || "netlify"
    })
  });

  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  if (!res.ok) {
    return {
      ok: false,
      error: "refund_rpc_failed",
      status: res.status,
      details: body
    };
  }

  return body && typeof body === "object" ? body : { ok: true, result: body };
}

module.exports = { refundGenerationOnce };
