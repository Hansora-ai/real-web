import crypto from 'node:crypto';
import { first, serviceInsert } from '../../lib/automation/db.mjs';
import { extractTikTokEvents, tiktokSignatureState } from '../../lib/automation/tiktok.mjs';

const text = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: String(body) });

// TikTok Business Messaging webhook (event type DIRECT_MESSAGE). Each event names a Business Account and a
// conversation; the background processor reads the new messages from TikTok's API and answers. Always answers 200
// quickly (TikTok retries for up to 72 hours otherwise), and the same event is processed once.
export async function handler(event) {
  if (event.httpMethod === 'GET') { const q = event.queryStringParameters || {}; return text(200, q.challenge || q['hub.challenge'] || 'ok'); }
  if (event.httpMethod !== 'POST') return text(405, 'method not allowed');
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : String(event.body || '');
    const header = event.headers?.['tiktok-signature'] || event.headers?.['Tiktok-Signature'] || event.headers?.['x-tiktok-signature'] || '';
    if (tiktokSignatureState(raw, header) === 'invalid') return text(401, 'invalid signature');
    let payload; try { payload = JSON.parse(raw || '{}'); } catch (_) { return text(400, 'invalid json'); }
    const events = extractTikTokEvents(payload);
    if (!events.length) console.log('tiktok webhook without a conversation', { keys: Object.keys(payload || {}).slice(0, 12) });
    const bodyHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
    for (const item of events) {
      const key = `tiktok:${item.businessId}:${item.conversationId}:${item.messageId || bodyHash}`;
      const inserted = await serviceInsert('automation_webhook_events', { provider: 'tiktok', external_event_id: key, event_type: 'tiktok_message', payload: { ...item, raw: payload }, status: 'received' }, { ignoreDuplicates: true });
      const row = inserted || await first(`/rest/v1/automation_webhook_events?provider=eq.tiktok&external_event_id=eq.${encodeURIComponent(key)}&select=id,status&limit=1`);
      if (row && ['received', 'failed'].includes(row.status)) await dispatchBackground(event, row.id).catch(error => console.error('tiktok dispatch failed', { message: error?.message }));
    }
    return text(200, 'EVENT_RECEIVED');
  } catch (error) { console.error('automation-tiktok-webhook error', { message: error?.message }); return text(200, 'EVENT_RECEIVED'); }
}

async function dispatchBackground(event, eventId) {
  const secret = String(process.env.HANSORA_AUTOMATION_INTERNAL_SECRET || '');
  const requestOrigin = (() => { try { return new URL(event.rawUrl || '').origin; } catch (_) { return ''; } })();
  const site = String(process.env.URL || process.env.DEPLOY_PRIME_URL || requestOrigin).replace(/\/$/, '');
  if (!secret || !site) throw new Error('automation_background_not_configured');
  const response = await fetch(`${site}/.netlify/functions/automation-tiktok-process-background`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hansora-internal-secret': secret }, body: JSON.stringify({ event_id: eventId }) });
  if (!response.ok && response.status !== 202) throw new Error('automation_background_dispatch_failed');
}
