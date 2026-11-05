// One lifecycle run: read the facts, plan, re-check payment, send through Resend, record every decision.
// Dependencies are passed in so the whole run can be tested without a database or Resend.
import { planRun } from './plan.mjs';
import { renderEmail } from './render.mjs';

export const FROM = 'Hansora <hello@hansora.co>';
export const REPLY_TO = 'hansoraai.co@gmail.com';
export const UNSUBSCRIBE = 'mailto:hansoraai.co@gmail.com?subject=Unsubscribe';
const TIME_BUDGET_MS = 20000; // scheduled functions get about 30 seconds
const GAP_MS = 550;           // Resend allows 2 requests per second

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendWithResend({ apiKey, from = FROM, replyTo = REPLY_TO, fetchImpl = fetch }, send, email) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': send.idempotency_key },
    body: JSON.stringify({
      from, to: [send.email], reply_to: replyTo, subject: email.subject, html: email.html, text: email.text,
      headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE}>` },
      tags: [{ name: 'campaign', value: send.campaign }, { name: 'lang', value: send.lang || 'en' }]
    }),
    signal: AbortSignal.timeout(8000)
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, id: body?.id || null, error: body?.message || body?.name || '' };
}

function counts(list) {
  const out = {};
  for (const item of list) out[item.campaign] = (out[item.campaign] || 0) + 1;
  return out;
}

// deps: { facts(), paidSince(send), record(row), saveRun(summary), send(send, email), notify(text), now, startedAt, skipDomains, dryRun }
export async function runLifecycle(deps) {
  const now = deps.now ?? Date.now();
  const startedAt = deps.startedAt ?? now;
  const facts = await deps.facts();
  const settings = facts.settings || {};
  const dryRun = Boolean(deps.dryRun || settings.dry_run);
  const limit = Math.max(1, Math.min(100, Number(settings.max_per_run) || 25));
  const planResult = planRun(facts, { now, skipDomains: deps.skipDomains || [] });
  const summary = { at: new Date(now).toISOString(), dry_run: dryRun, planned: counts(planResult.sends), sent: {}, skipped: {}, failed: [], deferred: 0, stopped: '' };
  for (const item of planResult.skips) summary.skipped[item.reason] = (summary.skipped[item.reason] || 0) + 1;

  if (planResult.halted) {
    summary.stopped = planResult.halted;
    await deps.saveRun?.(summary);
    await deps.notify?.(`⚠️ Lifecycle emails stopped: ${planResult.halted}. Nothing was sent.`);
    return summary;
  }
  if (dryRun) {
    summary.would_send = planResult.sends.map(s => ({ campaign: s.campaign, lang: s.lang, email: s.email, event_key: s.event_key, ...(s.vars ? { vars: s.vars } : {}) }));
    summary.would_skip = planResult.skips.filter(s => s.event_key || s.reason !== 'got a prices/abandoned email').slice(0, 100);
    await deps.saveRun?.(summary);
    return summary;
  }

  // Checkout/click skips are recorded so those events are not looked at again.
  for (const item of planResult.skips) {
    if (!item.event_key) continue;
    await deps.record({ email: item.email, user_id: item.user_id, campaign: item.campaign, status: 'skipped', event_key: item.event_key, reason: item.reason }).catch(() => null);
  }

  let sentCount = 0;
  for (let index = 0; index < planResult.sends.length; index++) {
    const send = planResult.sends[index];
    if (sentCount >= limit || Date.now() - startedAt > (deps.timeBudgetMs ?? TIME_BUDGET_MS)) { summary.deferred = planResult.sends.length - index; break; }
    const since = send.event_at || '1970-01-01T00:00:00Z';
    if (await deps.paidSince(send.user_id, send.email, since).catch(() => false)) {
      summary.skipped.paid = (summary.skipped.paid || 0) + 1;
      if (send.event_key?.startsWith('buy:') || send.event_key?.startsWith('click:')) await deps.record({ email: send.email, user_id: send.user_id, campaign: send.campaign, status: 'skipped', event_key: send.event_key, reason: 'paid (re-check)' }).catch(() => null);
      continue;
    }
    let email;
    try { email = renderEmail(send); } catch (error) { summary.failed.push({ email: send.email, campaign: send.campaign, error: String(error.message).slice(0, 120) }); continue; }
    let result;
    try { result = await deps.send(send, email); } catch (error) { result = { ok: false, status: 0, error: String(error?.message || error) }; }
    if (result.status === 429) { summary.stopped = 'Resend rate limit'; summary.deferred = planResult.sends.length - index; break; }
    if (!result.ok) {
      summary.failed.push({ email: send.email, campaign: send.campaign, status: result.status, error: String(result.error || '').slice(0, 120) });
      // A rejected address (4xx) is not retried; a Resend or network problem (5xx, 0) is retried next run.
      if (result.status >= 400 && result.status < 500) await deps.record({ email: send.email, user_id: send.user_id, campaign: send.campaign, status: 'failed', event_key: send.event_key, idempotency_key: send.idempotency_key, lang: send.lang, subject: email.subject, reason: `resend ${result.status}: ${String(result.error || '').slice(0, 200)}` }).catch(() => null);
      continue;
    }
    sentCount++;
    summary.sent[send.campaign] = (summary.sent[send.campaign] || 0) + 1;
    await deps.record({
      email: send.email, user_id: send.user_id, campaign: send.campaign, status: 'sent', event_key: send.event_key,
      idempotency_key: send.idempotency_key, sent_at: new Date().toISOString(), lang: send.lang, subject: email.subject,
      resend_id: result.id, details: { path: send.path || null, event_at: send.event_at || null, ...(send.vars || {}) }
    }).catch(error => summary.failed.push({ email: send.email, campaign: send.campaign, error: `sent, but not recorded: ${String(error?.message || error).slice(0, 100)}` }));
    await sleep(deps.gapMs ?? GAP_MS);
  }

  await deps.saveRun?.(summary);
  if (summary.stopped || summary.failed.length) {
    const lines = [`⚠️ Lifecycle emails: ${summary.stopped || 'some emails failed'}`];
    for (const item of summary.failed.slice(0, 5)) lines.push(`${item.campaign} ${item.email}: ${item.status || ''} ${item.error}`.trim());
    await deps.notify?.(lines.join('\n'));
  }
  return summary;
}

// Daily total, like the one the bot posted.
export function dailyMessage(rows) {
  const by = counts(rows);
  const total = rows.length;
  const names = { credits_used: 'credits-used', welcome: 'welcome', prices: 'prices', abandoned: 'abandoned-checkout' };
  const parts = ['credits_used', 'welcome', 'prices', 'abandoned'].map(key => `${by[key] || 0} ${names[key]}`);
  return `📬 Lifecycle emails, last 24 hours: ${total} sent\n${parts.join(', ')}`;
}
