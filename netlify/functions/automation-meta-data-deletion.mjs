import crypto from 'node:crypto';
import { safeEqual } from '../../lib/automation/crypto.mjs';
import { first, rows, serviceInsert, serviceUpdate, supabaseRequest } from '../../lib/automation/db.mjs';

// Meta "Data Deletion Request" and "Deauthorize" callbacks for Instagram / WhatsApp.
// Meta POSTs a signed_request when a person removes Hansora from their account. We verify it with the app
// secret, delete the data Hansora obtained through that account, and return a status URL + confirmation code.
// GET ?code=... returns the status for automation-data-deletion.html.
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

export function parseSignedRequest(signedRequest, secret) {
  const [signature, payload] = String(signedRequest || '').split('.');
  if (!signature || !payload || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return data?.algorithm?.toUpperCase() === 'HMAC-SHA256' ? data : null; } catch (_) { return null; }
}

function appSecrets() {
  return [process.env.META_INSTAGRAM_APP_SECRET, process.env.META_WHATSAPP_APP_SECRET, process.env.META_APP_SECRET].map(value => String(value || '').trim()).filter(Boolean);
}

async function deleteStoredMedia(businessId, channels) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
  for (const channel of channels) {
    const found = rows(await supabaseRequest(`/rest/v1/automation_messages?business_id=eq.${businessId}&metadata->>media_path=like.${encodeURIComponent(`${businessId}/${channel}/*`)}&select=metadata&limit=1000`));
    const paths = found.map(row => row.metadata?.media_path).filter(Boolean);
    for (let index = 0; index < paths.length; index += 100) {
      await fetch(`${base}/storage/v1/object/automation-media`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths.slice(index, index + 100) }) });
    }
  }
}

async function deleteAccountData(platformUserId) {
  const resources = rows(await supabaseRequest(`/rest/v1/automation_provider_resources?provider=eq.meta&provider_resource_id=eq.${encodeURIComponent(platformUserId)}&select=id,business_id,resource_type`));
  const businessIds = [...new Set(resources.map(resource => resource.business_id))];
  for (const resource of resources) {
    await supabaseRequest(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${resource.id}`, { method: 'DELETE' });
    await serviceUpdate('automation_provider_resources', `id=eq.${resource.id}`, { status: 'revoked', safe_config: {}, updated_at: new Date().toISOString() });
    const channels = resource.resource_type === 'whatsapp_account' ? ['whatsapp'] : ['instagram_dm', 'instagram_comments'];
    const list = `(${channels.join(',')})`;
    // Photos and voice notes kept for the inbox are removed with the messages they belong to.
    await deleteStoredMedia(resource.business_id, channels).catch(error => console.error('stored media not deleted', { message: error?.message }));
    // Contacts cascade to their conversations and messages.
    await supabaseRequest(`/rest/v1/automation_contacts?business_id=eq.${resource.business_id}&channel_type=in.${list}`, { method: 'DELETE' });
    if (resource.resource_type !== 'whatsapp_account') {
      await supabaseRequest(`/rest/v1/automation_comment_executions?business_id=eq.${resource.business_id}`, { method: 'DELETE' });
      await supabaseRequest(`/rest/v1/automation_flow_sessions?business_id=eq.${resource.business_id}`, { method: 'DELETE' });
    }
    await serviceUpdate('automation_channel_connections', `business_id=eq.${resource.business_id}&channel_type=in.${list}`, { status: 'not_connected', connected_account_label: null, connected_at: null, updated_at: new Date().toISOString() });
  }
  return businessIds;
}

export async function handler(event) {
  if (event.httpMethod === 'GET') {
    const code = String(event.queryStringParameters?.code || '').trim();
    if (!/^[A-Za-z0-9]{8,64}$/.test(code)) return json(400, { error: 'invalid_code' });
    const request = await first(`/rest/v1/automation_data_deletion_requests?confirmation_code=eq.${code}&select=status,created_at,completed_at&limit=1`).catch(() => null);
    return request ? json(200, request) : json(404, { error: 'not_found' });
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
    const form = new URLSearchParams(raw);
    const signed = form.get('signed_request');
    const data = appSecrets().map(secret => parseSignedRequest(signed, secret)).find(Boolean);
    if (!data?.user_id) return json(400, { error: 'invalid_signed_request' });
    const source = event.queryStringParameters?.type === 'deauthorize' ? 'meta_deauthorize' : 'meta_data_deletion';
    const code = crypto.randomBytes(12).toString('hex');
    await serviceInsert('automation_data_deletion_requests', { confirmation_code: code, source, platform_user_id: String(data.user_id), status: 'received' });
    const businessIds = await deleteAccountData(String(data.user_id));
    await serviceUpdate('automation_data_deletion_requests', `confirmation_code=eq.${code}`, { business_ids: businessIds, status: businessIds.length ? 'completed' : 'no_data', completed_at: new Date().toISOString() });
    const site = String(process.env.URL || 'https://hansora.co').replace(/\/$/, '');
    return json(200, { url: `${site}/automation-data-deletion.html?code=${code}`, confirmation_code: code });
  } catch (error) {
    console.error('automation-meta-data-deletion error', { message: error?.message });
    return json(500, { error: 'deletion_failed' });
  }
}
