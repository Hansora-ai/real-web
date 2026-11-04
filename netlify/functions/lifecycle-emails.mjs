// Lifecycle emails (abandoned checkout, prices, credits-used, welcome), every 10 minutes. Replaces the Grok Bot
// "Lifecycle" agent: same rules and approved templates, but plain code, so no AI credits are used.
// Switched on and off in the lifecycle_settings table (enabled, dry_run). Needs RESEND_API_KEY.
// Optional: LIFECYCLE_FROM, LIFECYCLE_REPLY_TO, LIFECYCLE_SKIP_DOMAINS (comma separated throwaway-mail domains),
// SALES_TELEGRAM_CHAT_ID + SALES_TELEGRAM_BOT_TOKEN/TELEGRAM_BOT_TOKEN for alerts and the daily total.
// Internal test: POST with x-hansora-internal-secret and {"dry_run": true} returns who would get what, sends nothing.
import { rows, supabaseRequest } from '../../lib/automation/db.mjs';
import { isInternalCall, isScheduledRun } from '../../lib/automation/schedule.mjs';
import { dailyMessage, runLifecycle, sendWithResend } from '../../lib/lifecycle/run.mjs';

export const config = { schedule: '*/10 * * * *' };

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

async function notify(text) {
  const chatId = String(process.env.SALES_TELEGRAM_CHAT_ID || '').trim();
  const token = String(process.env.SALES_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!chatId || !token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(4000)
  }).catch(() => null);
}

// Once a day, on the first run after 22:00 Yerevan time.
async function maybeDailySummary(settings, now) {
  const yerevan = new Date(now + 4 * 3600000);
  const today = yerevan.toISOString().slice(0, 10);
  if (yerevan.getUTCHours() < 22 || settings.last_summary_on === today) return;
  await supabaseRequest('/rest/v1/lifecycle_settings?id=eq.1', { method: 'PATCH', body: { last_summary_on: today } });
  const since = new Date(now - 86400000).toISOString();
  const sent = rows(await supabaseRequest(`/rest/v1/lifecycle_emails?status=eq.sent&sent_at=gte.${encodeURIComponent(since)}&select=campaign&limit=5000`));
  await notify(dailyMessage(sent));
}

export async function handler(event) {
  const internal = isInternalCall(event);
  if (!isScheduledRun(event) && !internal) return json(401, { error: 'unauthorized' });
  let forceDry = false;
  if (internal) { try { forceDry = JSON.parse(event.body || '{}').dry_run === true; } catch (_) { forceDry = false; } }

  const startedAt = Date.now();
  const settings = rows(await supabaseRequest('/rest/v1/lifecycle_settings?id=eq.1&select=enabled,dry_run,last_summary_on'))[0];
  if (!settings) return json(200, { ok: false, error: 'lifecycle_settings missing (run the migration)' });
  if (!settings.enabled && !forceDry) return json(200, { ok: true, enabled: false });
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey && !(forceDry || settings.dry_run)) return json(500, { ok: false, error: 'RESEND_API_KEY not set' });

  const summary = await runLifecycle({
    now: startedAt,
    startedAt,
    dryRun: forceDry,
    skipDomains: String(process.env.LIFECYCLE_SKIP_DOMAINS || '').split(','),
    facts: () => supabaseRequest('/rest/v1/rpc/lifecycle_facts', { method: 'POST', body: {} }),
    paidSince: (userId, email, since) => supabaseRequest('/rest/v1/rpc/lifecycle_paid_since', { method: 'POST', body: { p_user_id: userId || null, p_email: email || null, p_since: since } }).then(value => value === true),
    record: (row) => supabaseRequest('/rest/v1/lifecycle_emails?on_conflict=event_key', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=minimal' }),
    saveRun: forceDry ? null : (summary) => supabaseRequest('/rest/v1/lifecycle_settings?id=eq.1', { method: 'PATCH', body: { last_run_at: new Date().toISOString(), last_run: summary } }),
    send: (send, email) => sendWithResend({ apiKey, from: process.env.LIFECYCLE_FROM || undefined, replyTo: process.env.LIFECYCLE_REPLY_TO || undefined }, send, email),
    notify
  });
  if (!summary.dry_run) await maybeDailySummary(settings, startedAt).catch(() => null);
  return json(200, { ok: true, ...summary });
}
