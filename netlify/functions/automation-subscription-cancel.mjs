import { authenticateRequest } from '../../lib/sales-agent/auth.mjs';
import { first, serviceUpdate } from '../../lib/automation/db.mjs';
import { AUTOMATION_PLANS } from '../../lib/automation/billing.mjs';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const FEEDBACK = { price_too_high: 'too_expensive', not_using: 'unused', missing_features: 'missing_features', other: 'other' };

// Cancels the owner's monthly Automation plan at the end of the paid month (Dodo keeps it active until then).
// A Hansora Creative plan is a separate subscription and is never touched here.
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const key = process.env.DODO_PAYMENTS_API_KEY; const base = process.env.DODO_API_BASE || 'https://live.dodopayments.com';
    if (!key) return json(503, { error: 'payments_not_configured' });
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    let body; try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'invalid_json' }); }
    const reason = FEEDBACK[body.reason] ? body.reason : 'other';
    const subscription = await first(`/rest/v1/automation_subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`);
    if (!subscription || !AUTOMATION_PLANS[subscription.plan_id]) return json(404, { error: 'subscription_not_found' });
    if (subscription.status !== 'active') return json(409, { error: 'subscription_not_active' });
    if (subscription.cancel_at_period_end) return json(200, { ok: true, already_scheduled: true, subscription });
    if (!subscription.provider_subscription_id) return json(409, { error: 'missing_provider_subscription_id' });
    const response = await fetch(`${base}/subscriptions/${encodeURIComponent(subscription.provider_subscription_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ cancel_at_next_billing_date: true, cancel_reason: 'cancelled_by_customer', cancellation_feedback: FEEDBACK[reason], cancellation_comment: String(body.note || reason).slice(0, 1000) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) { console.error('automation plan cancel failed', { status: response.status }); return json(502, { error: 'cancel_failed' }); }
    const now = new Date().toISOString();
    await serviceUpdate('automation_subscriptions', `user_id=eq.${encodeURIComponent(user.id)}`, { cancel_at_period_end: true, canceled_at: now, updated_at: now });
    return json(200, { ok: true, subscription: { ...subscription, cancel_at_period_end: true, canceled_at: now } });
  } catch (error) {
    console.error('automation-subscription-cancel error', { message: error?.message });
    return json(error?.status || 500, { error: 'cancel_failed' });
  }
}
