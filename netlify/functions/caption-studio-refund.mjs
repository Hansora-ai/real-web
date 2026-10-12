import { authenticateRequest } from "../../lib/sales-agent/auth.mjs";
import { captionCost } from "../../public/caption-studio/core.mjs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

// Gives back the credits for the part of an auto-caption job that failed.
// The database decides (once per job, within 30 minutes, 3 per user per day).
export default async function handler(request) {
  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const user = await authenticateRequest({ headers: Object.fromEntries(request.headers) });
    if (!user) return json(401, { error: "Sign in first." });
    const body = await request.json().catch(() => ({}));
    const job = String(body.jobId || "");
    if (!/^[0-9a-f-]{36}$/i.test(job)) return json(400, { error: "Unknown job." });
    const kept = Number(body.keptSeconds) > 0 ? captionCost(Number(body.keptSeconds)) : 0;
    if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: "Refunds are not available right now." });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/refund_caption_job`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_job: job, p_user: user.id, p_kept_cost: kept }),
    });
    if (!r.ok) return json(502, { error: "Could not refund right now." });
    const result = await r.json();
    return json(200, { ...result, amount: Number(result.amount || 0) });
  } catch (error) {
    return json(error.status || 500, { error: error.status === 401 ? "Sign in first." : "Could not refund right now." });
  }
}
