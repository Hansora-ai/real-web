// Turns the Grok Bot Lifecycle dedup log (hansora-lifecycle-dedup.jsonl) into SQL that loads it into
// public.lifecycle_emails, so the 3-day and lifetime caps carry over and nobody gets the same email twice.
// It also sets lifecycle_settings.events_after to 20 minutes before the bot's latest run, so checkouts and clicks the bot already
// handled are never emailed again. Safe to run again (rows with the same event_key are skipped).
//
//   node scripts/import-lifecycle-bot-log.mjs path/to/hansora-lifecycle-dedup.jsonl > import.sql
//   then run import.sql in the Supabase SQL editor.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CAMPAIGNS = new Set(['abandoned', 'prices', 'credits_used', 'welcome']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = (value) => value === null || value === undefined || value === '' ? 'null' : `'${String(value).replace(/'/g, "''")}'`;

export function rowsFromLog(text) {
  const out = [];
  let latest = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch (_) { continue; }
    for (const key of ['sent_at', 'last_sent_at', 'last_successful_run']) { const t = Date.parse(d[key] || ''); if (Number.isFinite(t) && t > latest) latest = t; }
    if (!CAMPAIGNS.has(d.campaign) || !d.email) continue;
    const sentAt = d.last_sent_at || d.sent_at;
    if (!Number.isFinite(Date.parse(sentAt || ''))) continue;
    const key = String(d.idempotency_key || '');
    let userId = UUID.test(String(d.user_id || '')) ? d.user_id : null;
    const fromKey = key.match(/^(?:credits-used|welcome)-([0-9a-f-]{36})$/i);
    if (!userId && fromKey && UUID.test(fromKey[1])) userId = fromKey[1];
    let eventKey = null;
    if (d.campaign === 'abandoned' && Number.isInteger(d.row_id)) eventKey = `buy:${d.row_id}`;
    const click = key.match(/^prices-(\d+)$/) || (d.campaign === 'prices' && d.source_click_id ? [null, String(d.source_click_id)] : null);
    if (d.campaign === 'prices' && click) eventKey = `click:${click[1]}`;
    if ((d.campaign === 'credits_used' || d.campaign === 'welcome') && userId) eventKey = `${d.campaign}:${userId}`;
    out.push({ email: String(d.email).trim().toLowerCase(), user_id: userId, campaign: d.campaign, event_key: eventKey, idempotency_key: key || null, sent_at: new Date(sentAt).toISOString(), lang: d.lang ? String(d.lang).toLowerCase() : null, subject: d.subject || null, resend_id: d.resend_id || null });
  }
  return { rows: out, latest: latest ? new Date(latest).toISOString() : null };
}

export function importSql({ rows, latest }) {
  const lines = ['begin;'];
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map(r => `(${q(r.email)}, ${q(r.user_id)}::uuid, ${q(r.campaign)}, 'sent', ${q(r.event_key)}, ${q(r.idempotency_key)}, ${q(r.sent_at)}::timestamptz, ${q(r.lang)}, ${q(r.subject)}, ${q(r.resend_id)}, 'bot-import')`);
    lines.push(`insert into public.lifecycle_emails (email, user_id, campaign, status, event_key, idempotency_key, sent_at, lang, subject, resend_id, source)\nselect * from (values\n${values.join(',\n')}\n) v(email, user_id, campaign, status, event_key, idempotency_key, sent_at, lang, subject, resend_id, source)\nwhere not exists (select 1 from public.lifecycle_emails le where le.source = 'bot-import' and lower(le.email) = v.email and le.campaign = v.campaign and le.sent_at = v.sent_at)\non conflict (event_key) do nothing;`);
  }
  // The bot left clicks younger than 20 minutes for its next run, so start 20 minutes before its last run.
  if (latest) lines.push(`update public.lifecycle_settings set events_after = ${q(latest)}::timestamptz - interval '20 minutes' where id = 1;`);
  lines.push('commit;');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node scripts/import-lifecycle-bot-log.mjs hansora-lifecycle-dedup.jsonl > import.sql'); process.exit(1); }
  const parsed = rowsFromLog(await readFile(path, 'utf8'));
  process.stdout.write(importSql(parsed));
  console.error(`${parsed.rows.length} sends, latest ${parsed.latest}`);
}
