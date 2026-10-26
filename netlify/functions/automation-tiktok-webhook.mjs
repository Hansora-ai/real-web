import crypto from 'node:crypto';
import { first, serviceInsert } from '../../lib/automation/db.mjs';
import { extractTikTokComments, extractTikTokEvents, tiktokSignatureState } from '../../lib/automation/tiktok.mjs';

const text = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: String(body) });

// TikTok webhook for direct messages (event type DIRECT_MESSAGE) and comments on the business's videos
// (comment.update). A message event names a Business Account and a conversation, a comment event a video and a
// comment; background processors read the details from TikTok's API and answer. Always answers 200 quickly (TikTok
// retries for up to 72 hours otherwise), and the same event is processed once.
export async function handler(event) {
  if (event.httpMethod === 'GET') { const q = event.queryStringParameters || {}; return text(200, q.challenge || q['hub.challenge'] || 'ok'); }
  if (event.httpMethod !== 'POST') return text(405, 'method not allowed');
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : String(event.body || '');
    const header = event.headers?.['tiktok-signature'] || event.headers?.['Tiktok-Signature'] || event.headers?.['x-tiktok-signature'] || '';
    if (tiktokSignatureState(raw, header) === 'invalid') return text(401, 'invalid signature');
    let payload; try { payload = JSON.parse(raw || '{}'); } catch (_) { return text(400, 'invalid json'); }
    const comments = extractTikTokComments(payload, raw);
    const events = comments.length ? [] : extractTikTokEvents(payload);
    if (!events.length && !comments.length) console.log('tiktok webhook without a conversation or new comment', { event: String(payload?.event || '').slice(0, 60), keys: Object.keys(payload || {}).slice(0, 12) });
    const bodyHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
    for (const item of events) {
      const key = `tiktok:${item.businessId}:${item.conversationId}:${item.messageId || bodyHash}`;
      await record(event, key, 'tiktok_message', { ...item, raw: payload }, 'automation-tiktok-process-background');
    }
    for (const item of comments) await record(event, `tiktok:comment:${item.businessId}:${item.commentId}`, 'tiktok_comment', item, 'automation-tiktok-comment-process-background');
    return text(200, 'EVENT_RECEIVED');
  } catch (error) { console.error('automation-tiktok-webhook error', { message: error?.message }); return text(200, 'EVENT_RECEIVED'); }
}

async function record(event, key, eventType, payload, processor) {
  const inserted = await serviceInsert('automation_webhook_events', { provider: 'tiktok', external_event_id: key, event_type: eventType, payload, status: 'received' }, { ignoreDuplicates: true });
  const row = inserted || await first(`/rest/v1/automation_webhook_events?provider=eq.tiktok&external_event_id=eq.${encodeURIComponent(key)}&select=id,status&limit=1`);
  if (row && ['received', 'failed'].includes(row.status)) await dispatchBackground(event, row.id, processor).catch(error => console.error('tiktok dispatch failed', { message: error?.message }));
}

async function dispatchBackground(event, eventId, processor) {
  const secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
  const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || requestOrigin).replace(/\/$/, '');
  if (!secret || !site) throw new Error('automation_background_not_configured');
  const response = await fetch(`${site}/.netlify/functions/${processor}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hansora-internal-secret': secret }, body: JSON.stringify({ event_id: eventId }) });
  if (!response.ok && response.status !== 202) throw new Error('automation_background_dispatch_failed');
}
