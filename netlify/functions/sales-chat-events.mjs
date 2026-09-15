import { authenticateRequest, anonymousIdentity, isUuid } from '../../lib/sales-agent/auth.mjs';
import { ensureSession, recordEvent } from '../../lib/sales-agent/store.mjs';

const ALLOWED = new Set(['chat_opened', 'pricing_link_clicked', 'generate_link_clicked', 'checkout_started']);

function json(statusCode, body, cookie) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(cookie ? { 'Set-Cookie': cookie } : {})
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const anonymous = anonymousIdentity(event);
  try {
    const body = JSON.parse(event.body || '{}');
    if (!ALLOWED.has(body.type) || !isUuid(body.session_id) || !body.idempotency_key) {
      return json(400, { error: 'invalid_event' }, anonymous.setCookie);
    }
    const user = await authenticateRequest(event);
    const session = await ensureSession({
      user,
      anonymous,
      requestedSessionId: body.session_id,
      language: body.language
    });
    await recordEvent(session, {
      type: body.type,
      language: body.language,
      modelId: body.model_id,
      packageId: body.package_id,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      idempotencyKey: body.idempotency_key
    });
    return json(200, { ok: true }, anonymous.setCookie);
  } catch (error) {
    if (error?.status === 409) return json(200, { ok: true, replayed: true }, anonymous.setCookie);
    console.error('sales-chat-events error', { message: error?.message, status: error?.status });
    return json(Number(error?.status) || 500, { error: 'event_not_recorded' }, anonymous.setCookie);
  }
}
