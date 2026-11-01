// A Telegram message to the owner for every sale, sent by the payment webhooks right after the credits are
// added (once per payment). It needs two Netlify settings: SALES_TELEGRAM_CHAT_ID (the owner's Telegram id)
// and a bot that the owner has opened once: SALES_TELEGRAM_BOT_TOKEN, or the site's TELEGRAM_BOT_TOKEN.
// Without them, or if Telegram is slow or down, nothing happens and the payment is not affected.
import { INTERNAL_IDS } from "./access.mjs";

const TIMEOUT_MS = 4000;
const SYMBOL = { USD: "$", EUR: "€", GBP: "£", RUB: "₽", AMD: "֏" };

function money(cents, currency) {
  const code = String(currency || "").toUpperCase() === "643" ? "RUB" : String(currency || "").toUpperCase();
  const value = Number(cents) / 100;
  if (!Number.isFinite(value) || value <= 0) return "";
  const amount = value.toFixed(value % 1 ? 2 : 0);
  return SYMBOL[code] ? (code === "RUB" ? `${amount} ₽` : `${SYMBOL[code]}${amount}`) : `${amount} ${code}`.trim();
}

function ago(iso, now) {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// The message text. `facts` is what the database knows about the buyer (any of it may be missing).
export function saleMessage({ provider, amountCents, currency, credits, plan = false }, facts = {}, now = Date.now()) {
  const paid = money(amountCents, currency);
  const where = provider === "yoomoney" ? "YooMoney" : "Dodo";
  const head = [`💰 ${paid || "New sale"}`, credits ? `${Math.round(Number(credits) * 10).toLocaleString("en-US")} credits${plan ? " (plan)" : ""}` : "", where].filter(Boolean).join(" · ");
  const lines = [head];
  if (facts.email) lines.push(facts.email);
  const about = [];
  if (facts.previousPurchases === 0) about.push("first purchase");
  else if (facts.previousPurchases > 0) about.push(`purchase #${facts.previousPurchases + 1}`);
  const since = facts.signedUpAt ? ago(facts.signedUpAt, now) : "";
  if (since) about.push(`signed up ${since}`);
  if (facts.chatgpt === true) about.push("uses ChatGPT");
  else if (facts.chatgpt === false) about.push("website");
  if (about.length) lines.push(about.join(" · "));
  return lines.join("\n");
}

async function rows(supabaseUrl, serviceKey, path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await response.json().catch(() => null);
  return response.ok && Array.isArray(body) ? body : null;
}

async function buyerFacts({ supabaseUrl, serviceKey, uid, transactionId }) {
  const id = encodeURIComponent(uid);
  const [profile, earlier, chatgpt] = await Promise.all([
    rows(supabaseUrl, serviceKey, `profiles?user_id=eq.${id}&select=email,a&limit=1`).catch(() => null),
    rows(supabaseUrl, serviceKey, `payments?uid=eq.${id}&status=eq.succeeded&transaction_id=neq.${encodeURIComponent(transactionId)}&select=transaction_id&limit=50`).catch(() => null),
    rows(supabaseUrl, serviceKey, `chatgpt_events?user_id=eq.${id}&select=id&limit=1`).catch(() => null)
  ]);
  return {
    email: profile?.[0]?.email || "",
    signedUpAt: profile?.[0]?.a || "",
    previousPurchases: earlier ? earlier.length : null,
    chatgpt: chatgpt ? chatgpt.length > 0 : null
  };
}

export async function notifySale(sale, { supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  const chatId = String(process.env.SALES_TELEGRAM_CHAT_ID || "").trim();
  const token = String(process.env.SALES_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!chatId || !token || !sale?.uid || INTERNAL_IDS.includes(sale.uid)) return { sent: false };
  try {
    const facts = supabaseUrl && serviceKey ? await buyerFacts({ supabaseUrl, serviceKey, uid: sale.uid, transactionId: sale.transactionId || "" }).catch(() => ({})) : {};
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: saleMessage(sale, facts), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return { sent: response.ok };
  } catch (error) {
    console.warn("sale_alert_failed", String(error?.message || error).slice(0, 200));
    return { sent: false };
  }
}
