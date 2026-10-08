// Pay-as-you-go for Hansora Automation using the shared Hansora credit balance (profiles.credits).
// Stored credits are shown to users ×10 as ⚡ (see CREDIT_DISPLAY_MULTIPLIER in public/header.js),
// so 0.1 stored credit = 1⚡ ≈ $0.01. Charges happen server-side only, after the AI reply was actually
// sent, exactly once per idempotency key, using the same "update only if the balance is unchanged"
// guard as the Hansora Creative run functions.
import * as db from './db.mjs';

const number = (name, fallback) => { const value = Number(process.env[name]); return Number.isFinite(value) && value >= 0 ? value : fallback; };

// Prices in stored credits. Change here (or with the env vars) when provider costs change.
export function automationPrices() {
  return {
    aiReply: number('AUTOMATION_CREDITS_PER_AI_REPLY', 0.1),       // 1⚡
    testReply: number('AUTOMATION_CREDITS_PER_TEST_REPLY', 0.1),   // 1⚡
    commentRun: number('AUTOMATION_CREDITS_PER_COMMENT_RUN', 0.1), // 1⚡ per person per comment automation run (all its steps)
    voiceMinute: number('AUTOMATION_CREDITS_PER_VOICE_MINUTE', 0.8), // 8⚡ per minute
    testVoiceMinute: number('AUTOMATION_CREDITS_PER_TEST_VOICE_MINUTE', 0.8)
  };
}

export const DISPLAY_MULTIPLIER = 10;
export const toDisplay = credits => Math.round(Number(credits || 0) * DISPLAY_MULTIPLIER * 100) / 100;
const round1 = value => Math.round(Number(value || 0) * 10) / 10;

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
      change = -Math.max(0, round1(Math.floor(before * 10) / 10));
      if (change === 0) return { ok: false, error: 'insufficient_credits', balance: before };
    }
    const after = Math.max(0, round1(before + change));
    const updated = d.rows(await d.supabaseRequest(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&credits=eq.${encodeURIComponent(String(before))}`, { method: 'PATCH', body: { credits: after }, prefer: 'return=representation' }));
    if (updated.length === 1) return { ok: true, before, after, charged: round1(before - after) };
  }
  return { ok: false, error: 'balance_busy' };
}

// Charge once per idempotency key. allowPartial is for calls that already happened: take what is left.
export async function chargeCredits({ businessId, idempotencyKey, kind, credits, conversationId = null, reference = {}, allowPartial = false }, overrides = {}) {
  const d = deps(overrides);
  const amount = round1(credits);
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
