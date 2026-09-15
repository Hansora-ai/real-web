const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';

export function assertDatabaseConfigured() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('sales_agent_database_not_configured');
}

export async function supabaseRequest(path, { method = 'GET', body, prefer = '' } = {}) {
  assertDatabaseConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`sales_agent_database_error_${response.status}`);
      error.status = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export const rows = (value) => Array.isArray(value) ? value : [];

export async function insertRow(table, value) {
  const result = await supabaseRequest(`/rest/v1/${table}`, {
    method: 'POST', body: value, prefer: 'return=representation'
  });
  return rows(result)[0] || null;
}

export async function updateRows(table, query, value) {
  return rows(await supabaseRequest(`/rest/v1/${table}?${query}`, {
    method: 'PATCH', body: value, prefer: 'return=representation'
  }));
}

export async function rpc(name, value) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { method: 'POST', body: value });
}
