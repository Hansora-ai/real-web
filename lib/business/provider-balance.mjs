// Kie and reAPI balances, checked every 10 minutes (netlify/functions/provider-balance-alert.mjs). The owner gets
// one Telegram message when a balance drops below the low level, another when it is almost empty, and one when it
// is topped up again, so customers do not meet "insufficient credits" errors first.
// Levels can be set in Netlify: KIE_LOW_CREDITS (Kie credits, default 2000) and REAPI_LOW_USD (dollars, default 10).
import { OWNER_ID } from "./access.mjs";
import { sendOwnerTelegram } from "./sale-alert.mjs";

const TIMEOUT_MS = 8000;

export function providers(env = process.env) {
  return [
    {
      id: "kie",
      name: "Kie",
      configured: Boolean(env.KIE_API_KEY),
      low: Number(env.KIE_LOW_CREDITS) || 2000,
      async balance(fetchImpl = fetch) {
        const base = String(env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/, "");
        const res = await fetchImpl(`${base}/api/v1/chat/credit`, { headers: { Authorization: `Bearer ${env.KIE_API_KEY}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = await res.json().catch(() => null);
        const value = Number(data?.data);
        if (!res.ok || Number(data?.code) !== 200 || !Number.isFinite(value)) throw new Error(`kie_balance_${res.status}_${data?.code ?? ""}`);
        return value;
      },
      describe: (value) => `${Math.round(value).toLocaleString("en-US")} Kie credits`
    },
    {
      id: "reapi",
      name: "reAPI",
      configured: Boolean(env.REAPI_API_KEY),
      low: (Number(env.REAPI_LOW_USD) || 10) * 1000,
      async balance(fetchImpl = fetch) {
        const base = String(env.REAPI_BASE_URL || "https://reapi.ai/api/v1").replace(/\/+$/, "");
        const res = await fetchImpl(`${base}/balance`, { headers: { Authorization: `Bearer ${env.REAPI_API_KEY}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = await res.json().catch(() => null);
        const value = Number(data?.balance);
        if (!res.ok || !Number.isFinite(value)) throw new Error(`reapi_balance_${res.status}`);
        return value;
      },
      // 1 reAPI credit = $0.001.
      describe: (value) => `$${(value / 1000).toFixed(2)} (${Math.round(value).toLocaleString("en-US")} credits)`
    }
  ];
}

export function levelOf(value, low) {
  if (value < low / 5) return "empty";
  if (value < low) return "low";
  return "ok";
}

const RANK = { ok: 0, low: 1, empty: 2 };

export function alertText(provider, level, value) {
  const amount = provider.describe(value);
  if (level === "empty") return `🚨 ${provider.name} is almost empty: ${amount} left. Generations on ${provider.name} will start failing — top up now.`;
  if (level === "low") return `⚠️ ${provider.name} balance is low: ${amount} left. Top up soon to avoid failed generations.`;
  return `✅ ${provider.name} topped up: ${amount}.`;
}

// Alert on a worse level, and once when it is back to normal; nothing while the level stays the same.
export function shouldAlert(previous, level) {
  if (!previous) return level !== "ok";
  if (previous === level) return false;
  return RANK[level] > RANK[previous] || level === "ok";
}

async function lastLevels(supabaseUrl, serviceKey, fetchImpl) {
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/chatgpt_events?tool=eq.provider_balance&select=model_id,outcome,created_at&order=created_at.desc&limit=20`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const rows = res.ok ? await res.json().catch(() => []) : [];
  const levels = {};
  for (const row of Array.isArray(rows) ? rows : []) if (row.model_id && !levels[row.model_id]) levels[row.model_id] = row.outcome;
  return levels;
}

async function saveLevel(supabaseUrl, serviceKey, fetchImpl, provider, level, value) {
  await fetchImpl(`${supabaseUrl}/rest/v1/chatgpt_events`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: OWNER_ID, tool: "provider_balance", model_id: provider.id, outcome: level, balance: value, details: { low: provider.low } }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }).catch(() => {});
}

export async function checkProviderBalances({ env = process.env, fetchImpl = fetch, send = sendOwnerTelegram } = {}) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const stored = Boolean(supabaseUrl && serviceKey);
  const previous = stored ? await lastLevels(supabaseUrl, serviceKey, fetchImpl).catch(() => ({})) : {};
  const results = [];
  for (const provider of providers(env)) {
    if (!provider.configured) continue;
    let value;
    try {
      value = await provider.balance(fetchImpl);
    } catch (error) {
      // A failed check never alerts: the next run tries again.
      results.push({ provider: provider.id, error: String(error?.message || error) });
      continue;
    }
    const level = levelOf(value, provider.low);
    const alert = shouldAlert(previous[provider.id], level);
    if (alert) {
      await send(alertText(provider, level, value));
      if (stored) await saveLevel(supabaseUrl, serviceKey, fetchImpl, provider, level, value);
    }
    results.push({ provider: provider.id, balance: value, level, alerted: alert });
  }
  return results;
}
