// Purchases from the Hansora phone app (App Store / Google Play), reported by RevenueCat.
// RevenueCat → Project settings → Integrations → Webhooks: URL https://hansora.co/.netlify/functions/revenuecat-webhook
// and an Authorization header value; the same value goes in the Netlify variable REVENUECAT_WEBHOOK_AUTH.
// Grants the same credits and plans as the website (see lib/business/app-purchases.mjs). Repeated events never add twice.
import { timingSafeEqual } from 'node:crypto';
import { describeEvent, addCreditsOnce, writePlan } from '../../lib/business/app-purchases.mjs';
import { notifySale } from '../../lib/business/sale-alert.mjs';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

export function authorized(headers = {}, expected = process.env.REVENUECAT_WEBHOOK_AUTH || '') {
  if (!expected) return false;
  const given = String(headers.authorization || headers.Authorization || '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handler(event, deps = {}) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!authorized(event.headers || {}, deps.webhookAuth ?? process.env.REVENUECAT_WEBHOOK_AUTH)) return json(401, { error: 'unauthorized' });
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')); }
  catch { return json(400, { error: 'invalid_json' }); }

  const info = describeEvent(body.event || {});
  const supabaseUrl = deps.supabaseUrl || process.env.SUPABASE_URL;
  const serviceKey = deps.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fetchImpl = deps.fetchImpl || fetch;
  const tellOwner = deps.notifySale || notifySale;
  const log = { type: info.type, product: info.product, provider: info.provider, environment: info.environment, action: info.action };

  try {
    if (info.action === 'ignore') { console.log('app purchase ignored', { ...log, reason: info.reason }); return json(200, { ok: true, ignored: info.reason }); }
    if (info.action === 'refund_alert') {
      console.warn('app purchase refunded', { ...log, uid: info.uid, transaction: info.transactionId });
      return json(200, { ok: true, refunded: true });
    }
    if (info.action === 'credit_pack') {
      const result = await addCreditsOnce({ supabaseUrl, serviceKey, fetchImpl, paymentId: info.paymentId, uid: info.uid, credits: info.credits, amountCents: info.amountCents, currency: info.currency, provider: info.provider, payload: body.event, bucket: 'payg' });
      if (result.credited) await tellOwner({ uid: info.uid, transactionId: info.paymentId, provider: info.provider, amountCents: info.amountCents, currency: info.currency, credits: info.credits }, { supabaseUrl, serviceKey }).catch(() => null);
      if (!result.credited && result.reason !== 'already credited') { console.error('app pack not credited', { ...log, reason: result.reason }); return json(500, { error: result.reason }); }
      return json(200, { ok: true, credited: result.credited, reason: result.reason });
    }
    // Monthly plans.
    const plan = await writePlan({ supabaseUrl, serviceKey, fetchImpl, info });
    if (!plan.written && plan.reason !== 'another subscription is current') { console.error('app plan not saved', { ...log, reason: plan.reason }); return json(500, { error: plan.reason }); }
    let credited = false;
    if (info.action === 'plan_active' && info.credits > 0 && info.paymentId) {
      const result = await addCreditsOnce({ supabaseUrl, serviceKey, fetchImpl, paymentId: info.paymentId, uid: info.uid, credits: info.credits, amountCents: info.amountCents, currency: info.currency, provider: info.provider, payload: body.event, bucket: info.config.automation ? 'payg' : 'monthly' });
      credited = result.credited;
      if (credited) await tellOwner({ uid: info.uid, transactionId: info.paymentId, provider: info.provider, amountCents: info.amountCents, currency: info.currency, credits: info.credits, plan: true }, { supabaseUrl, serviceKey }).catch(() => null);
      if (!result.credited && result.reason !== 'already credited') { console.error('app plan credits not added', { ...log, reason: result.reason }); return json(500, { error: result.reason }); }
    }
    return json(200, { ok: true, plan: info.planId, status: info.status, saved: plan.written, credited });
  } catch (error) {
    console.error('app purchase failed', { ...log, message: error?.message });
    return json(500, { error: 'app_purchase_failed' });
  }
}
