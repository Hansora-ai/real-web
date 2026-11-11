// Auto top-up settings for the signed-in customer (see lib/business/auto-topup.mjs).
// GET  → current settings, the packs and levels on offer, and the last few top-ups.
// POST { action: "setup", pack_credits, threshold_credits } → switches on; returns checkout_url when a card must be saved.
// POST { action: "off" } → stops top-ups, keeps the saved card so switching on again needs no checkout.
// POST { action: "remove_card" } → cancels the Dodo mandate; switching on again opens a new checkout.
import { PACKS, THRESHOLDS, DEFAULTS, MAX_PER_DAY, config, db, dodo, checkoutBody, packFor, validThreshold } from "../../lib/business/auto-topup.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

// `handle` takes fetch and env so the tests can run it without the network.
export const handler = (event) => handle(event);

export async function handle(event, { fetchImpl = fetch, env = process.env } = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  const token = bearer(event.headers || {});
  if (!token) return json(401, { error: "missing_auth" });
  const cfg = config(env);
  if (!cfg.supabaseUrl || !cfg.serviceKey) return json(500, { error: "missing_env" });

  const userRes = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: cfg.serviceKey } });
  const user = userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user?.id) return json(401, { error: "invalid_auth" });

  const store = db(cfg, fetchImpl);
  const available = Boolean(cfg.dodoKey && cfg.productId);
  const view = async (extra = {}) => json(200, {
    available,
    settings: publicSettings(await store.settings(user.id)),
    packs: PACKS,
    thresholds: THRESHOLDS,
    max_per_day: MAX_PER_DAY,
    charges: await store.recentCharges(user.id),
    ...extra
  });

  if (event.httpMethod === "GET") return view();

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad_json" }); }
  const current = await store.settings(user.id);
  const filter = `user_id=eq.${encodeURIComponent(user.id)}`;

  if (body.action === "off") {
    if (current) await store.patchSettings(filter, { enabled: false });
    return view();
  }

  if (body.action === "remove_card") {
    if (current?.subscription_id && current.status === "active") {
      if (!cfg.dodoKey) return json(500, { error: "missing_env" });
      const result = await dodo(cfg, `/subscriptions/${encodeURIComponent(current.subscription_id)}`, { method: "PATCH", body: { status: "cancelled" } }, fetchImpl);
      if (!result.ok) return json(502, { error: "dodo_cancel_failed" });
    }
    if (current) await store.patchSettings(filter, { enabled: false, status: "cancelled" });
    return view();
  }

  if (body.action !== "setup") return json(400, { error: "unknown_action" });
  if (!available) return json(503, { error: "auto_topup_unavailable" });
  const pack = packFor(body.pack_credits ?? current?.pack_credits ?? DEFAULTS.pack_credits);
  const threshold = Number(body.threshold_credits ?? current?.threshold_credits ?? DEFAULTS.threshold_credits);
  if (!pack) return json(400, { error: "bad_pack" });
  if (!validThreshold(threshold)) return json(400, { error: "bad_threshold" });

  // Card already saved: just switch on with the new choice (a new choice also clears old failures).
  if (current?.status === "active" && current.subscription_id) {
    const saved = await store.patchSettings(filter, { enabled: true, pack_credits: pack.credits, threshold_credits: threshold, failures: 0, last_error: null });
    if (!saved) return json(500, { error: "save_failed" });
    return view();
  }

  const saved = await store.saveSettings({ user_id: user.id, enabled: false, status: "pending", pack_credits: pack.credits, threshold_credits: threshold, failures: 0, last_error: null });
  if (!saved) return json(500, { error: "save_failed" });
  const returnPath = /^\/profile(_ru|_arm)?\.html$/.test(String(body.return_path || "")) ? body.return_path : "/profile.html";
  const result = await dodo(cfg, "/checkouts", { method: "POST", body: checkoutBody({ cfg, userId: user.id, email: user.email, returnPath }) }, fetchImpl);
  const checkoutUrl = result.data?.checkout_url;
  if (!result.ok || !checkoutUrl) {
    console.error("auto_topup_checkout_failed", result.status, JSON.stringify(result.data || {}).slice(0, 500));
    return json(502, { error: "checkout_failed" });
  }
  return view({ checkout_url: checkoutUrl });
}

export function publicSettings(row) {
  if (!row) return { enabled: false, status: "none", pack_credits: DEFAULTS.pack_credits, threshold_credits: DEFAULTS.threshold_credits, card_saved: false, failures: 0, last_error: null };
  return {
    enabled: Boolean(row.enabled),
    status: row.status,
    pack_credits: row.pack_credits,
    threshold_credits: row.threshold_credits,
    card_saved: row.status === "active" && Boolean(row.subscription_id),
    failures: row.failures || 0,
    last_error: row.last_error || null
  };
}

function bearer(headers) {
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(String(key ? headers[key] : ""));
  return match ? match[1].trim() : "";
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...CORS }, body: JSON.stringify(body) };
}
