// Service-role database access for Hansora Automation. Automation tables live in their own
// "automation" schema (separate from Hansora Creative's public tables); everything else, such as
// profiles.credits, stays in public. PostgREST picks the schema from the Accept-Profile /
// Content-Profile headers, which are added here based on the table in the path.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
export const AUTOMATION_SCHEMA = 'automation';

export const rows = (value) => Array.isArray(value) ? value : [];

export function schemaFor(path) {
  return /^\/rest\/v1\/(?:rpc\/)?automation_/.test(String(path)) ? AUTOMATION_SCHEMA : null;
}

export async function supabaseRequest(path, { method = 'GET', body, prefer = '' } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('automation_database_not_configured');
  const schema = schemaFor(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
        ...(schema ? { 'Accept-Profile': schema, 'Content-Profile': schema } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`automation_database_error_${response.status}`);
      error.status = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function serviceInsert(table, value, { ignoreDuplicates = false } = {}) {
  const prefer = `${ignoreDuplicates ? 'resolution=ignore-duplicates,' : ''}return=representation`;
  return rows(await supabaseRequest(`/rest/v1/${table}`, { method: 'POST', body: value, prefer }))[0] || null;
}

export async function serviceUpsert(table, onConflict, value) {
  const query = `?on_conflict=${encodeURIComponent(onConflict)}`;
  return rows(await supabaseRequest(`/rest/v1/${table}${query}`, { method: 'POST', body: value, prefer: 'resolution=merge-duplicates,return=representation' }))[0] || null;
}

export async function serviceUpdate(table, query, value) {
  return rows(await supabaseRequest(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: value, prefer: 'return=representation' }));
}

export async function first(path) { return rows(await supabaseRequest(path))[0] || null; }

// Same shapes as lib/sales-agent/db.mjs, for callers that used those helpers.
export async function insertRow(table, value) { return serviceInsert(table, value); }
export async function updateRows(table, query, value) { return serviceUpdate(table, query, value); }
