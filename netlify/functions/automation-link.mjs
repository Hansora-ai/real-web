import { sha256 } from '../../lib/automation/crypto.mjs';
import { recordFlowEvent, verifyTrackedLink } from '../../lib/automation/flow-stats.mjs';

// Tracked website button: count the click for the automation's results, then send the person on.
export async function handler(event) {
  const link = verifyTrackedLink(event.queryStringParameters || {});
  if (!link) return { statusCode: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'This link is not valid.' };
  if (/^[0-9a-f-]{36}$/i.test(link.b) && /^[0-9a-f-]{36}$/i.test(link.w)) {
    const bucket = Math.floor(Date.now() / 60000); // one click per person/link per minute
    await recordFlowEvent({ businessId: link.b, workflowId: link.w, sessionId: /^[0-9a-f-]{36}$/i.test(link.s) ? link.s : null, nodeId: link.n, actionId: link.a, eventType: 'click', idempotencyKey: `link:${link.w}:${link.a}:${link.s || sha256(event.headers?.['x-nf-client-connection-ip'] || 'anon').slice(0, 16)}:${bucket}` });
  }
  return { statusCode: 302, headers: { Location: link.u, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: '' };
}
