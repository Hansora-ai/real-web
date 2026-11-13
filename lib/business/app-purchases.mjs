// Purchases made inside the Hansora phone app (Apple App Store / Google Play), reported by RevenueCat.
// They grant exactly what the same purchase grants on the website (netlify/functions/dodo-webhook.mjs):
// - credit packs → pay-as-you-go credits (stored credits; the website shows them ×10 with ⚡),
// - Creative monthly plans → public.user_subscriptions + monthly credits,
// - Automation monthly plans → automation.automation_subscriptions + credits in the pay-as-you-go bucket.
// Every grant is recorded in public.payments with a unique transaction_id, so a repeated event never adds twice.

import { AUTOMATION_PLANS } from '../automation/billing.mjs';

// Store product IDs (the same IDs in App Store Connect and Google Play). Credits are stored credits.
export const APP_PACKS = {
  'co.hansora.app.credits.900': 90,     // 900⚡ · $9.99
  'co.hansora.app.credits.2000': 200,   // 1,800⚡ + 200⚡ free · $19.99
  'co.hansora.app.credits.5100': 510,   // 4,500⚡ + 600⚡ free · $49.99
  'co.hansora.app.credits.10500': 1050  // 9,000⚡ + 1,500⚡ free · $99.99
};

export const APP_PLANS = {
  'co.hansora.app.creative.premium.monthly': 'premium_monthly',
  'co.hansora.app.creative.pro.monthly': 'pro_monthly',
  'co.hansora.app.creative.promax.monthly': 'pro_max_monthly',
  'co.hansora.app.automation.lite.monthly': 'automation_lite_monthly',
  'co.hansora.app.automation.starter.monthly': 'automation_starter_monthly',
  'co.hansora.app.automation.growth.monthly': 'automation_growth_monthly',
  'co.hansora.app.automation.business.monthly': 'automation_business_monthly',
  'co.hansora.app.automation.scale.monthly': 'automation_scale_monthly'
};

// Same as SUBSCRIPTION_PLANS in dodo-webhook.mjs (Creative plans).
export const CREATIVE_PLANS = {
  premium_monthly: { monthlyCredits: 250, unlimitedModels: ['Nano Banana 2 Lite', 'Nano Banana 2 1K', 'Z Image', 'GPT Image 2 1K', 'Seedream 5.0 Lite', 'Grok Video 6s'] },
  pro_monthly: { monthlyCredits: 450, unlimitedModels: ['Nano Banana 2 Lite', 'Nano Banana 2 1K', 'Z Image', 'GPT Image 2 1K', 'Seedream 5.0 Lite', 'Grok Video 6s', 'Veo 3.1 Lite 720p 8s'] },
  pro_max_monthly: { monthlyCredits: 1000, unlimitedModels: ['Nano Banana 2 Lite', 'Nano Banana 2 1K-2K', 'Z Image', 'GPT Image 2 1K-2K', 'Seedream 5.0 Lite', 'Wan 2.7 Image', 'Grok Video 6s', 'Veo 3.1 Lite 1080p 8s', 'Kling 2.5 Turbo 1080p 5s'] }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Google Play reports subscriptions as "productId:basePlanId".
export function baseProductId(productId) { return String(productId || '').split(':')[0].trim(); }

export function planConfig(planId) {
  if (CREATIVE_PLANS[planId]) return { ...CREATIVE_PLANS[planId], automation: false };
  const plan = AUTOMATION_PLANS[planId];
  return plan ? { monthlyCredits: plan.credits, unlimitedModels: [], automation: true } : null;
}

// The signed-in Hansora user: the app logs in to RevenueCat with the Supabase user id.
export function userIdFrom(event = {}) {
  const ids = [event.app_user_id, event.original_app_user_id, ...(Array.isArray(event.aliases) ? event.aliases : [])];
  return ids.find(id => UUID.test(String(id || ''))) || null;
}

export function providerFrom(event = {}) {
  const store = String(event.store || '').toUpperCase();
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'apple';
  if (store === 'PLAY_STORE') return 'google';
  return store ? store.toLowerCase() : 'app';
}

const iso = ms => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);
const dateKey = value => (value ? String(value).slice(0, 10) : 'unknown');

// What one RevenueCat event means for Hansora. Pure: no database access.
export function describeEvent(event = {}) {
  const type = String(event.type || '').toUpperCase();
  const product = baseProductId(event.product_id);
  const uid = userIdFrom(event);
  const provider = providerFrom(event);
  const transactionId = String(event.transaction_id || event.id || '');
  const amountCents = Number.isFinite(Number(event.price)) ? Math.round(Number(event.price) * 100) : null;
  const base = { type, product, uid, provider, transactionId, amountCents, currency: 'USD', environment: event.environment || null };
  if (type === 'TEST') return { ...base, action: 'ignore', reason: 'test event' };
  if (!uid) return { ...base, action: 'ignore', reason: 'no Hansora user id on the purchase' };

  if (APP_PACKS[product]) {
    if (type === 'NON_RENEWING_PURCHASE' || type === 'INITIAL_PURCHASE') {
      if (!transactionId) return { ...base, action: 'ignore', reason: 'no transaction id' };
      return { ...base, action: 'credit_pack', credits: APP_PACKS[product], paymentId: `app:${provider}:${transactionId}` };
    }
    if (type === 'CANCELLATION') return { ...base, action: 'refund_alert', reason: 'pack refunded by the store' };
    return { ...base, action: 'ignore', reason: `pack event ${type}` };
  }

  const planId = APP_PLANS[product];
  if (!planId) return { ...base, action: 'ignore', reason: `unknown product ${product || '(none)'}` };
  const config = planConfig(planId);
  const periodStart = iso(event.purchased_at_ms) || new Date().toISOString();
  const periodEnd = iso(event.expiration_at_ms);
  const subscriptionId = `${provider}:${event.original_transaction_id || transactionId}`;
  const plan = { planId, config, periodStart, periodEnd, subscriptionId };
  if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED'].includes(type)) {
    const grant = type === 'INITIAL_PURCHASE' || type === 'RENEWAL';
    return {
      ...base, ...plan, action: 'plan_active', status: 'active', cancelAtPeriodEnd: false,
      credits: grant ? config.monthlyCredits : 0,
      // One grant per paid period, whatever event repeats it.
      paymentId: grant ? `app:${provider}:${transactionId || dateKey(periodStart)}:monthly-credits` : null
    };
  }
  if (type === 'CANCELLATION') {
    // A refund ends the plan now; a normal cancel keeps it until the period ends (like the website).
    const refunded = String(event.cancel_reason || '').toUpperCase() === 'CUSTOMER_SUPPORT';
    return { ...base, ...plan, action: 'plan_status', status: refunded ? 'cancelled' : 'active', cancelAtPeriodEnd: !refunded, canceledAt: new Date().toISOString() };
  }
  if (type === 'BILLING_ISSUE') return { ...base, ...plan, action: 'plan_status', status: 'on_hold' };
  if (type === 'EXPIRATION') return { ...base, ...plan, action: 'plan_status', status: 'expired' };
  if (type === 'PRODUCT_CHANGE') return { ...base, ...plan, action: 'ignore', reason: 'the new plan starts with its own RENEWAL event' };
  return { ...base, ...plan, action: 'ignore', reason: `plan event ${type}` };
}

// ---------- Database (Supabase REST with the service key) ----------
function headers(serviceKey, extra = {}) {
  return { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...extra };
}
async function readJson(res) { try { return await res.json(); } catch { return null; } }

// Adds credits exactly once per paymentId (insert, then a compare-and-set on status, as in dodo-webhook.mjs).
export async function addCreditsOnce({ supabaseUrl, serviceKey, fetchImpl = fetch, paymentId, uid, credits, amountCents, currency, provider, payload, bucket = 'payg' }) {
  const row = { transaction_id: paymentId, uid, credits, amount_cents: amountCents, currency, provider, return_url: null, payload, paid_at: new Date().toISOString() };
  let res = await fetchImpl(`${supabaseUrl}/rest/v1/payments?on_conflict=transaction_id`, {
    method: 'POST', headers: headers(serviceKey, { Prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify([{ ...row, status: null }])
  });
  if (!res.ok) return { credited: false, reason: 'payments insert failed', detail: await readJson(res) };
  res = await fetchImpl(`${supabaseUrl}/rest/v1/payments?transaction_id=eq.${encodeURIComponent(paymentId)}&status=is.null`, {
    method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=representation' }), body: JSON.stringify({ ...row, status: 'succeeded' })
  });
  const won = await readJson(res);
  if (!res.ok || !Array.isArray(won) || !won.length) return { credited: false, reason: 'already credited' };
  res = await fetchImpl(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}&select=credits,monthly_credits,payg_credits`, { headers: headers(serviceKey) });
  const rows = await readJson(res);
  if (!res.ok || !Array.isArray(rows) || !rows.length) return { credited: false, reason: 'profile not found' };
  const monthly = Number(rows[0].monthly_credits ?? 0);
  const payg = Number(rows[0].payg_credits ?? rows[0].credits ?? 0);
  const next = bucket === 'monthly' ? { monthly_credits: monthly + credits, payg_credits: payg } : { monthly_credits: monthly, payg_credits: payg + credits };
  res = await fetchImpl(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=representation' }), body: JSON.stringify({ ...next, credits: next.monthly_credits + next.payg_credits })
  });
  const updated = await readJson(res);
  if (!res.ok || !Array.isArray(updated) || !updated.length) return { credited: false, reason: 'profile update failed' };
  return { credited: true, reason: bucket === 'monthly' ? 'monthly credits added' : 'pay-as-you-go credits added' };
}

function subscriptionTable(config) {
  return config.automation
    ? { table: 'automation_subscriptions', profile: { 'Accept-Profile': 'automation', 'Content-Profile': 'automation' } }
    : { table: 'user_subscriptions', profile: {} };
}

// The plan row for this user. A status change from the store only touches the row of the same store subscription,
// so an app event never ends a plan the person bought on the website.
export async function writePlan({ supabaseUrl, serviceKey, fetchImpl = fetch, info }) {
  const { table, profile } = subscriptionTable(info.config);
  if (info.action === 'plan_status') {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(info.uid)}&select=provider_subscription_id`, { headers: headers(serviceKey, profile) });
    const rows = await readJson(res);
    const current = Array.isArray(rows) && rows[0] ? rows[0].provider_subscription_id : null;
    if (current !== info.subscriptionId) return { written: false, reason: 'another subscription is current' };
  }
  const row = {
    user_id: info.uid,
    status: info.status,
    plan_id: info.planId,
    ...(info.config.automation ? {} : { unlimited_models: info.config.unlimitedModels }),
    provider: info.provider,
    provider_customer_id: info.uid,
    provider_subscription_id: info.subscriptionId,
    current_period_start: info.periodStart,
    current_period_end: info.periodEnd,
    cancel_at_period_end: Boolean(info.cancelAtPeriodEnd),
    canceled_at: info.canceledAt || null,
    updated_at: new Date().toISOString()
  };
  // A status change keeps the dates already saved when the event has none.
  if (info.action === 'plan_status') { for (const key of ['current_period_start', 'current_period_end']) if (!row[key]) delete row[key]; }
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?on_conflict=user_id`, {
    method: 'POST', headers: headers(serviceKey, { ...profile, Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify([row])
  });
  if (!res.ok) return { written: false, reason: `${table} upsert failed`, detail: await readJson(res) };
  return { written: true };
}
