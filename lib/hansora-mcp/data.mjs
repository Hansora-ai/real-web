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

// Reads answer within a few seconds: a slow database must not hold ChatGPT long enough to show
// "server error". A short hiccup (network error, 5xx, 429) is retried once.
async function serviceGet(path) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('server_misconfigured');
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${SUPABASE_URL}${path}`, { headers: serviceHeaders(), signal: AbortSignal.timeout(6000) });
    } catch (error) {
      if (attempt === 0) continue;
      throw new Error(`data_request_failed_network: ${error?.message || error}`);
    }
    if (response.ok) return response.json();
    if (attempt === 0 && (response.status >= 500 || response.status === 429)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    throw new Error(`data_request_failed_${response.status}`);
  }
}

export class AuthUnavailableError extends Error {
  constructor() { super('auth_temporarily_unavailable'); }
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
  // Only a definite "this token is not valid" may log the user out. When Supabase itself is down or slow,
  // say so instead: answering 401 makes ChatGPT drop the user's login and try to refresh it.
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new AuthUnavailableError();
  }
  if (response.status >= 500 || response.status === 429) throw new AuthUnavailableError();
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

// True when the account has never received a result (on the website or in ChatGPT); a failed or
// refused attempt does not count. If the lookup
// fails we say "has generated", which keeps the usual behaviour of asking before switching model.
export async function isFirstGeneration(userId) {
  try {
    const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&result_url=not.is.null&select=id&limit=1`);
    return Array.isArray(rows) && rows.length === 0;
  } catch {
    return false;
  }
}

// The user's most recent video that has a result, for offering "the same as your last video" first.
// Null when there is none or the lookup fails.
export async function getLastVideo(userId) {
  try {
    const fields = 'id,provider,kind,created_at,meta';
    const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&kind=eq.video&result_url=not.is.null&select=${fields}&order=created_at.desc&limit=1`);
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

// How many of the user's videos on one reAPI engine are still being made (recent ones only, so an old row
// stuck as processing never blocks them). Zero when the lookup fails.
export async function countRunning(userId, engine) {
  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&meta->>engine=eq.${encodeURIComponent(engine)}&meta->>status=in.(pending,processing)&result_url=is.null&created_at=gte.${encodeURIComponent(since)}&select=id&limit=60`);
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

// The latest Veo runs from everyone (website and ChatGPT), newest first, to tell whether Google is having an
// outage. Only a few columns of a few rows; an empty list when the lookup fails.
export async function getRecentVeoRuns(sinceIso) {
  try {
    const rows = await serviceGet(`/rest/v1/user_generations?provider=in.(veo3.1lite,veo3.1fast,veo3.1)&created_at=gte.${encodeURIComponent(sinceIso)}&select=created_at,result_url,status:meta->>status,error:meta->>error&order=created_at.desc&limit=30`);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Whether one of these ChatGPT outcomes was logged for the user recently (for example the first video already
// steered to Grok, so a following Veo request is the exception ChatGPT chose on purpose). False on errors.
export async function hadRecentOutcome(userId, outcomes, sinceIso) {
  try {
    const rows = await serviceGet(`/rest/v1/chatgpt_events?user_id=eq.${encodeURIComponent(userId)}&outcome=in.(${outcomes.map(encodeURIComponent).join(',')})&created_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// The saved video recipe for a run, or null.
export async function getFirstVideoRecipe(userId, runId) {
  try {
    const rows = await serviceGet(`/rest/v1/chatgpt_events?user_id=eq.${encodeURIComponent(userId)}&run_id=eq.${encodeURIComponent(runId)}&tool=in.(first_video_recipe,video_recipe)&select=model_id,details&order=created_at.desc&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && row.details && typeof row.details === 'object' ? { ...row.details, model_id: row.model_id } : null;
  } catch {
    return null;
  }
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

// Recent runs of every user, for spotting a model that is failing for everyone right now.
export async function getRecentRuns(sinceIso, limit = 400) {
  const fields = [
    'provider', 'created_at', 'result_url',
    'status:meta->>status', 'model:meta->>model', 'engine:meta->>engine', 'model_id:meta->>model_id',
    'error:meta->error', 'error_code:meta->>error_code', 'error_summary:meta->>error_summary',
    'provider_message:meta->>provider_message', 'provider_code:meta->>provider_code', 'submit_error:meta->>submit_error', 'fail_reason:meta->fail_reason'
  ].join(',');
  const rows = await serviceGet(`/rest/v1/user_generations?created_at=gte.${encodeURIComponent(sinceIso)}&select=${fields}&order=created_at.desc&limit=${limit}`);
  return Array.isArray(rows) ? rows : [];
}

// Every file the user's recent generations saved in Hansora storage (main result and extra outputs), newest first.
export async function getRecentResultUrls(userId, limit = 60) {
  const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&result_url=not.is.null&select=result_url,meta->result_urls,meta->storage_paths,meta->>storage_bucket&order=created_at.desc&limit=${Math.max(1, Math.min(200, limit))}`);
  const urls = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.result_url) urls.push(String(row.result_url));
    for (const url of Array.isArray(row.result_urls) ? row.result_urls : []) if (url) urls.push(String(url));
    const bucket = row.storage_bucket || 'generation-history';
    for (const path of Array.isArray(row.storage_paths) ? row.storage_paths : []) if (path) urls.push(`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`);
  }
  return [...new Set(urls)];
}

// True when one of the user's Grok videos failed since the given time. A failed lookup counts as no.
export async function hadRecentGrokFailure(userId, sinceIso) {
  try {
    const rows = await serviceGet(`/rest/v1/user_generations?user_id=eq.${encodeURIComponent(userId)}&provider=eq.Grok&meta->>status=eq.failed&created_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
