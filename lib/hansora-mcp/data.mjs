import { normalizeGenerationResult } from './generation-results.mjs';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

function serviceHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra
  };
}

async function serviceGet(path) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('server_misconfigured');
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: serviceHeaders(),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`data_request_failed_${response.status}`);
  return response.json();
}

export async function authenticateToken(token) {
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null;
  let claims;
  try {
    const payload = String(token).split('.')[1] || '';
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // MCP access is granted through the Supabase OAuth server. Ordinary Hansora
  // browser sessions do not contain a client_id and cannot be reused here.
  if (!claims?.client_id) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return null;
  const value = await response.json().catch(() => null);
  const user = value?.user || value;
  const scopes = String(claims.scope || '').split(/\s+/).filter(Boolean);
  return user?.id ? {
    id: String(user.id),
    email: user.email || null,
    clientId: String(claims.client_id),
    scopes
  } : null;
}

export async function getAccount(userId) {
  const [profiles, subscriptions] = await Promise.all([
    serviceGet(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=credits&limit=1`),
    serviceGet(`/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,plan_id,current_period_end&limit=1`).catch(() => [])
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  const subscription = Array.isArray(subscriptions) ? subscriptions[0] : null;
  return {
    internal_credits: Number(profile?.credits || 0),
    displayed_credits: Number((Number(profile?.credits || 0) * 10).toFixed(2)),
    subscription: subscription || null
  };
}

export async function getGeneration(userId, runId) {
  const fields = 'id,provider,kind,prompt,result_url,created_at,meta';
  const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&meta->>run_id=eq.${encodeURIComponent(runId)}&select=${fields}&order=created_at.desc&limit=1`);
  return normalizeGenerationResult(Array.isArray(rows) ? rows[0] || null : null);
}

export async function listGenerations(userId, limit = 10, status = '') {
  const safeLimit = Math.max(1, Math.min(50, Math.round(Number(limit) || 10)));
  const fields = 'id,provider,kind,prompt,result_url,created_at,meta';
  const statusFilter = status ? `&meta->>status=eq.${encodeURIComponent(status)}` : '';
  const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}${statusFilter}&select=${fields}&order=created_at.desc&limit=${safeLimit}`);
  return Array.isArray(rows) ? rows.map(normalizeGenerationResult) : [];
}

export function getServiceConfig() {
  return { supabaseUrl: SUPABASE_URL, configured: Boolean(SUPABASE_URL && SERVICE_KEY) };
}

// ChatGPT shows one card per answer, so when it starts several generations in a row the earlier
// ones have no card of their own. Group a run with the user's other ChatGPT runs started in the same
// burst (each within BATCH_GAP_MS of the previous one) so a single card can show all of them.
const BATCH_GAP_MS = 2 * 60 * 1000;
const BATCH_MAX = 50;

export async function getGenerationBatch(userId, runId) {
  const fields = 'id,provider,kind,prompt,result_url,created_at,meta';
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&meta->>run_id=like.*-mcp-*&created_at=gte.${encodeURIComponent(since)}&select=${fields}&order=created_at.desc&limit=200`);
  const runs = (Array.isArray(rows) ? rows : [])
    .map(normalizeGenerationResult)
    .filter((row) => row?.meta?.run_id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const index = runs.findIndex((row) => row.meta.run_id === runId);
  if (index < 0) return [];
  let start = index;
  let end = index;
  const gap = (a, b) => Math.abs(Date.parse(runs[b].created_at) - Date.parse(runs[a].created_at));
  while (start > 0 && gap(start - 1, start) <= BATCH_GAP_MS) start -= 1;
  while (end < runs.length - 1 && gap(end, end + 1) <= BATCH_GAP_MS) end += 1;
  const batch = runs.slice(start, end + 1);
  return batch.length > BATCH_MAX ? batch.slice(batch.length - BATCH_MAX) : batch;
}
