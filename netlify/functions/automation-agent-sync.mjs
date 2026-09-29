import { authenticateRequest, isUuid } from '../../lib/sales-agent/auth.mjs';
import { syncBusinessAgent } from '../../lib/automation/agent-sync.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(statusCode, body) { return { statusCode, headers: HEADERS, body: JSON.stringify(body) }; }
function parseBody(event) {
  if (Buffer.byteLength(event.body || '', 'utf8') > 4096) { const error = new Error('request_too_large'); error.status = 413; throw error; }
  try { return JSON.parse(event.body || '{}'); } catch (_) { const error = new Error('invalid_json'); error.status = 400; throw error; }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const user = await authenticateRequest(event);
    if (!user) return json(401, { error: 'authentication_required' });
    const body = parseBody(event);
    if (!isUuid(body.business_id)) return json(400, { error: 'invalid_business_id' });
    const synchronized = await syncBusinessAgent({ businessId: body.business_id, userId: user.id });
    return json(200, { ok: true, provider: synchronized.provider, created: synchronized.created, status: 'active' });
  } catch (error) {
    console.error('automation-agent-sync error', { message: error?.message, status: error?.status, providerStatus: error?.providerStatus, providerMessage: error?.providerMessage });
    const status = Number(error?.status) || 500;
    const allowed = new Set(['invalid_json','request_too_large','business_not_found','agent_configuration_incomplete','elevenlabs_not_configured','automation_provider_not_supported','elevenlabs_request_failed']);
    // The owner sees ElevenLabs' own reason (for example an invalid key or setting) instead of a generic failure.
    return json(status, { error: allowed.has(error?.message) ? error.message : status >= 500 ? 'automation_sync_unavailable' : 'automation_sync_failed', ...(error?.providerMessage ? { detail: error.providerMessage, provider_status: error.providerStatus } : {}) });
  }
}
