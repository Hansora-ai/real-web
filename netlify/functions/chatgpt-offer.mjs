// The welcome offer for the signed-in person (see lib/business/chatgpt-offer.mjs).
// GET → { eligible, active, expires_at, seconds_left, bonus_percent, packs, starter }, or { pending: true } while
// the timer has not started. GET ?start=1 (sent by the pricing page) starts the 8-hour timer for someone who
// never bought; later calls return the same deadline.
import { config, db, offerView } from "../../lib/business/chatgpt-offer.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

// `handle` takes fetch and env so the tests can run it without the network.
export const handler = (event) => handle(event);

export async function handle(event, { fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });

  const header = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "authorization");
  const token = header ? String(header[1] || "").replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return json(401, { error: "missing_auth" });
  const cfg = config(env);
  if (!cfg.supabaseUrl || !cfg.serviceKey) return json(500, { error: "missing_env" });

  const userRes = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: cfg.serviceKey } });
  const user = userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user?.id) return json(401, { error: "invalid_auth" });

  try {
    const start = String(event.queryStringParameters?.start || "") === "1";
    return json(200, await offerView({ cfg, store: db(cfg, fetchImpl), userId: user.id, start, now }));
  } catch (error) {
    console.error("chatgpt-offer failed", error?.message || error);
    // The page works without the offer: answer "nothing to show" instead of an error.
    return json(200, { eligible: false, active: false });
  }
}

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}
