// The connected TikTok Business Account of an AI employee and a valid token for it (refreshed when it expires).
import { decryptSecret, encryptSecret } from './crypto.mjs';
import { first, serviceUpsert } from './db.mjs';
import { refreshTikTokToken } from './tiktok.mjs';

const enc = value => encodeURIComponent(String(value));

export async function tiktokAccountFor({ businessId = null, tiktokBusinessId = null }) {
  const filter = businessId ? `business_id=eq.${enc(businessId)}` : `provider_resource_id=eq.${enc(tiktokBusinessId)}`;
  return first(`/rest/v1/automation_provider_resources?provider=eq.tiktok&resource_type=eq.tiktok_account&${filter}&status=eq.active&select=*&limit=1`);
}

export async function tiktokTokenFor(account, { fetchImpl = fetch } = {}) {
  const [access, refresh] = await Promise.all([
    first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.access_token&select=*&limit=1`),
    first(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${account.id}&credential_type=eq.refresh_token&select=*&limit=1`)
  ]);
  if (!access) throw Object.assign(new Error('tiktok_token_not_found'), { status: 409 });
  // Still valid for at least 5 more minutes: use it.
  if (!access.expires_at || Date.parse(access.expires_at) > Date.now() + 5 * 60000) return decryptSecret(access);
  if (!refresh) throw Object.assign(new Error('tiktok_token_expired'), { status: 409 });
  const tokens = await refreshTikTokToken({ refreshToken: decryptSecret(refresh), fetchImpl });
  await saveTikTokTokens({ account, tokens });
  return tokens.accessToken;
}

export async function saveTikTokTokens({ account, tokens }) {
  await serviceUpsert('automation_provider_credentials', 'provider_resource_id,credential_type', { business_id: account.business_id, provider_resource_id: account.id, credential_type: 'access_token', ...encryptSecret(tokens.accessToken), expires_at: tokens.expiresAt });
  if (tokens.refreshToken) await serviceUpsert('automation_provider_credentials', 'provider_resource_id,credential_type', { business_id: account.business_id, provider_resource_id: account.id, credential_type: 'refresh_token', ...encryptSecret(tokens.refreshToken), expires_at: tokens.refreshExpiresAt });
}
