// Pay-as-you-go for Hansora Automation using the shared Hansora credit balance (profiles.credits).
// Stored credits are shown to users ×10 as ⚡ (see CREDIT_DISPLAY_MULTIPLIER in public/header.js),
// so 0.1 stored credit = 1⚡ ≈ $0.01. Charges happen server-side only, after the AI reply was actually
// sent, exactly once per idempotency key, using the same "update only if the balance is unchanged"
// guard as the Hansora Creative run functions.
import * as db from './db.mjs';

const number = (name, fallback) => { const value = Number(process.env[name]); return Number.isFinite(value) && value >= 0 ? value : fallback; };

// Prices in stored credits (shown ×10 as ⚡). Pay as you go; the monthly Automation plans below charge less per
// action. Balances keep 2 decimals, so the smallest step is 0.01 stored credit = 0.1⚡.
export function automationPrices() {
  const aiReply = number('AUTOMATION_CREDITS_PER_AI_REPLY', 0.12); // 1.2⚡
  return {
    aiReply,
    mediaReply: number('AUTOMATION_CREDITS_PER_MEDIA_REPLY', 0.2),  // 2⚡: the customer sent a photo or a video
    testReply: number('AUTOMATION_CREDITS_PER_TEST_REPLY', aiReply),
    commentRun: number('AUTOMATION_CREDITS_PER_COMMENT_RUN', 0.1), // 1⚡ per person per comment automation run (all its steps)
    voiceMinute: number('AUTOMATION_CREDITS_PER_VOICE_MINUTE', 0.8), // 8⚡ per minute
    testVoiceMinute: number('AUTOMATION_CREDITS_PER_TEST_VOICE_MINUTE', 0.8)
  };
}

// Monthly Automation plans (Dodo subscriptions, international cards). $1 = 100⚡ like pay as you go; the plan makes
// every action cheaper. `credits` are stored credits added each paid month.
export const AUTOMATION_PLANS = {
  automation_starter_monthly: { name: 'Starter', price: 49, credits: 490, rates: { aiReply: 0.1, mediaReply: 0.2, commentRun: 0.1, voiceMinute: 0.8 } },
  automation_growth_monthly: { name: 'Growth', price: 99, credits: 990, rates: { aiReply: 0.1, mediaReply: 0.2, commentRun: 0.05, voiceMinute: 0.7 } },
  automation_business_monthly: { name: 'Business', price: 149, credits: 1490, rates: { aiReply: 0.09, mediaReply: 0.2, commentRun: 0.05, voiceMinute: 0.7 } },
  automation_scale_monthly: { name: 'Scale', price: 199, credits: 1990, rates: { aiReply: 0.08, mediaReply: 0.2, commentRun: 0.03, voiceMinute: 0.6 } }
};

export function planIsActive(subscription, now = Date.now()) {
  if (!subscription || !AUTOMATION_PLANS[subscription.plan_id]) return false;
  if (subscription.status !== 'active') return false;
  return !subscription.current_period_end || Date.parse(subscription.current_period_end) > now - 86_400_000; // 1 day grace for late renewals
}

export function pricesForPlan(planId) {
  const rates = AUTOMATION_PLANS[planId]?.rates;
  const base = automationPrices();
  return rates ? { ...base, ...rates, testReply: rates.aiReply, plan: planId } : { ...base, plan: null };
}

// The prices for this AI employee's owner: their active monthly plan, or pay as you go. Never blocks a reply.
export async function automationPricesFor(businessId, overrides = {}) {
  try {
    const d = deps(overrides);
    const userId = await businessOwner(businessId, d);
    const subscription = await d.first(`/rest/v1/automation_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan_id,status,current_period_end&limit=1`);
    return pricesForPlan(planIsActive(subscription) ? subscription.plan_id : null);
  } catch (error) {
    console.warn('automation plan lookup failed, using pay-as-you-go prices', { message: error?.message });
    return pricesForPlan(null);
  }
}

// A reply to a photo or video costs mediaReply; voice notes and text cost a normal AI reply.
export const replyPrice = (rates, media) => ['image', 'video'].includes(media?.kind) ? rates.mediaReply : rates.aiReply;

export const DISPLAY_MULTIPLIER = 10;
export const toDisplay = credits => Math.round(Number(credits || 0) * DISPLAY_MULTIPLIER * 100) / 100;
const round2 = value => Math.round(Number(value || 0) * 100) / 100;

// Calls are charged once at the end, rounded up to the next whole ⚡ (0.1 stored credit).
export function voiceCredits(seconds, perMinute = automationPrices().voiceMinute) {
  const raw = Math.max(0, Number(seconds) || 0) / 60 * perMinute;
  return raw > 0 ? Math.ceil(raw * 10 - 1e-9) / 10 : 0;
}

// How many seconds of AI voice the balance covers, so a call can end politely before it runs out.
export function affordableVoiceSeconds(balance, perMinute = automationPrices().voiceMinute) {
  if (!(perMinute > 0)) return Infinity;
  return Math.max(0, Math.floor(Number(balance || 0) / perMinute * 60));
}

function deps(overrides) { return { first: db.first, serviceInsert: db.serviceInsert, serviceUpdate: db.serviceUpdate, supabaseRequest: db.supabaseRequest, rows: db.rows, ...overrides }; }

export async function businessOwner(businessId, overrides = {}) {
  const d = deps(overrides);
  const business = await d.first(`/rest/v1/automation_businesses?id=eq.${businessId}&select=owner_user_id&limit=1`);
  if (!business?.owner_user_id) throw Object.assign(new Error('business_owner_not_found'), { status: 404 });
  return business.owner_user_id;
}

export async function creditBalance(userId, overrides = {}) {
  const d = deps(overrides);
  const profile = await d.first(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=credits&limit=1`);
  return Number(profile?.credits || 0);
}

export async function canAfford(businessId, credits, overrides = {}) {
  if (!(credits > 0)) return { ok: true, balance: null, userId: null };
  const userId = await businessOwner(businessId, overrides);
  const balance = await creditBalance(userId, overrides);
  return { ok: balance >= credits - 1e-9, balance, userId };
}

// Compare-and-swap on profiles.credits: only writes if the balance is still what we read.
async function adjustBalance(userId, delta, { allowPartial = false } = {}, d) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await creditBalance(userId, d);
    let change = delta;
    if (delta < 0 && before + delta < -1e-9) {
      if (!allowPartial) return { ok: false, error: 'insufficient_credits', balance: before };
      change = -Math.max(0, round2(Math.floor(before * 100) / 100));
      if (change === 0) return { ok: false, error: 'insufficient_credits', balance: before };
    }
    const after = Math.max(0, round2(before + change));
    const updated = d.rows(await d.supabaseRequest(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&credits=eq.${encodeURIComponent(String(before))}`, { method: 'PATCH', body: { credits: after }, prefer: 'return=representation' }));
    if (updated.length === 1) return { ok: true, before, after, charged: round2(before - after) };
  }
  return { ok: false, error: 'balance_busy' };
}

// Charge once per idempotency key. allowPartial is for calls that already happened: take what is left.
export async function chargeCredits({ businessId, idempotencyKey, kind, credits, conversationId = null, reference = {}, allowPartial = false }, overrides = {}) {
  const d = deps(overrides);
  const amount = round2(credits);
  if (!(amount > 0)) return { ok: true, charged: 0, free: true };
  const userId = await businessOwner(businessId, d);
  const claim = await d.serviceInsert('automation_credit_charges', { business_id: businessId, user_id: userId, idempotency_key: idempotencyKey, kind, credits: amount, status: 'pending', conversation_id: conversationId, reference }, { ignoreDuplicates: true });
  if (!claim) {
    const existing = await d.first(`/rest/v1/automation_credit_charges?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=status,credits,balance_after&limit=1`);
    return { ok: existing?.status === 'charged', duplicate: true, charged: existing?.status === 'charged' ? Number(existing.credits) : 0, balance: existing?.balance_after ?? null };
  }
  const result = await adjustBalance(userId, -amount, { allowPartial }, d);
  if (!result.ok) {
    await d.serviceUpdate('automation_credit_charges', `id=eq.${claim.id}`, { status: result.error === 'insufficient_credits' ? 'insufficient' : 'failed', balance_after: result.balance ?? null, updated_at: new Date().toISOString() });
    return { ok: false, error: result.error, balance: result.balance ?? null, charged: 0 };
  }
  await d.serviceUpdate('automation_credit_charges', `id=eq.${claim.id}`, { status: 'charged', credits: result.charged, balance_after: result.after, updated_at: new Date().toISOString() });
  return { ok: true, charged: result.charged, balance: result.after, partial: result.charged < amount };
}

// Give credits back once (for example when a charged action is reversed).
export async function refundCredits(idempotencyKey, overrides = {}) {
  const d = deps(overrides);
  const claimed = d.rows(await d.supabaseRequest(`/rest/v1/automation_credit_charges?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&status=eq.charged`, { method: 'PATCH', body: { status: 'refunded', updated_at: new Date().toISOString() }, prefer: 'return=representation' }));
  const charge = claimed[0];
  if (!charge) return { ok: false, error: 'nothing_to_refund' };
  const result = await adjustBalance(charge.user_id, Number(charge.credits), {}, d);
  if (!result.ok) {
    await d.serviceUpdate('automation_credit_charges', `id=eq.${charge.id}`, { status: 'charged', updated_at: new Date().toISOString() });
    return { ok: false, error: result.error };
  }
  return { ok: true, refunded: Number(charge.credits), balance: result.after };
}

// Out of credits: the conversation goes to the owner and they get one alert per business per day.
export async function handleOutOfCredits({ businessId, conversationId, businessName, channel, customer, notifyOwner }, overrides = {}) {
  const d = deps(overrides);
  if (conversationId) await d.serviceUpdate('automation_conversations', `id=eq.${conversationId}&business_id=eq.${businessId}`, { status: 'needs_attention', intent: 'Out of credits' }).catch(() => null);
  const day = new Date().toISOString().slice(0, 10);
  await notifyOwner({ businessId, event: 'handoff_requested', idempotencyKey: `out_of_credits:${businessId}:${day}`, data: { businessId, conversationId, business: businessName || 'Your business', channel, customer: customer || 'Customer', details: 'Your Hansora credits ran out. Top up to keep your AI employee answering.' } }).catch(error => console.error('out of credits alert failed', { message: error?.message }));
}
