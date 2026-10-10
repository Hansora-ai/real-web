import { serviceUpdate, serviceUpsert, supabaseRequest } from '../../lib/automation/db.mjs';
import { exchangeTikTokCode, getTikTokBusinessProfile, readTikTokState } from '../../lib/automation/tiktok.mjs';
import { saveTikTokTokens } from '../../lib/automation/tiktok-account.mjs';
import { tiktokRedirectUri } from './automation-tiktok-connect.mjs';

const back = (businessId, status, reason = '') => ({ statusCode: 302, headers: { Location: `/automation-connect.html?channel=tiktok${businessId ? `&business=${encodeURIComponent(businessId)}` : ''}&tiktok=${status}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`, 'Cache-Control': 'no-store' }, body: '' });

// TikTok sends the owner back here after they allowed Hansora. The account and its tokens are stored (encrypted),
// one TikTok account per AI employee, and the TikTok channel is switched on.
export async function handler(event) {
  const q = event.queryStringParameters || {};
  const state = readTikTokState(q.state);
  if (!state) return back('', 'error', 'expired');
  if (q.error || !(q.code || q.auth_code)) return back(state.businessId, 'error', String(q.error_description || q.error || 'cancelled').slice(0, 120));
  try {
    const tokens = await exchangeTikTokCode({ code: String(q.code || q.auth_code), redirectUri: tiktokRedirectUri(event) });
    const profile = await getTikTokBusinessProfile({ businessId: tokens.businessId, token: tokens.accessToken });
    // Like Messenger: the owner then reviews the settings on the connect page and presses Finish to go live.
    // A TikTok account answers for one AI employee: an earlier connection elsewhere, or an earlier account here, is closed.
    const old = await supabaseRequest(`/rest/v1/automation_provider_resources?provider=eq.tiktok&resource_type=eq.tiktok_account&status=eq.active&or=(business_id.eq.${state.businessId},provider_resource_id.eq.${encodeURIComponent(tokens.businessId)})&select=id,business_id,provider_resource_id`);
    for (const row of Array.isArray(old) ? old : []) {
      if (row.business_id === state.businessId && row.provider_resource_id === tokens.businessId) continue;
      await supabaseRequest(`/rest/v1/automation_provider_credentials?provider_resource_id=eq.${row.id}`, { method: 'DELETE' });
      await serviceUpdate('automation_provider_resources', `id=eq.${row.id}`, { status: 'revoked', updated_at: new Date().toISOString() });
      if (row.business_id !== state.businessId) await serviceUpdate('automation_channel_connections', `business_id=eq.${row.business_id}&channel_type=eq.tiktok`, { status: 'not_connected', connected_account_label: null, connected_at: null, updated_at: new Date().toISOString() });
    }
    const label = profile.username ? `@${profile.username}` : profile.name || 'TikTok account';
    const account = await serviceUpsert('automation_provider_resources', 'business_id,provider,resource_type,provider_resource_id', { business_id: state.businessId, provider: 'tiktok', resource_type: 'tiktok_account', provider_resource_id: tokens.businessId, status: 'active', safe_config: { username: profile.username, display_name: profile.name, picture: profile.picture, scope: tokens.scope }, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await saveTikTokTokens({ account, tokens });
    await serviceUpdate('automation_channel_connections', `business_id=eq.${state.businessId}&channel_type=eq.tiktok`, { status: 'connecting', provider: 'tiktok', connected_account_label: label, connected_at: null, last_error_code: null, updated_at: new Date().toISOString() });
    return back(state.businessId, 'connected');
  } catch (error) {
    console.error('automation-tiktok-callback error', { message: error?.message, providerCode: error?.providerCode, providerMessage: error?.providerMessage });
    return back(state.businessId, 'error', error?.providerMessage || 'connect_failed');
  }
}
