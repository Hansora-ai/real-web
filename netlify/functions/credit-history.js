exports.handler = async function(event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': event.headers.origin || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'method_not_allowed' })
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;
  const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLIC_ANON_KEY ||
    SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'missing_supabase_env' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'missing_auth_token' })
    };
  }

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!userRes.ok) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'invalid_auth_token' })
      };
    }

    const user = await userRes.json();
    if (!user?.id) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'invalid_user' })
      };
    }

    const requestedLimit = Number(event.queryStringParameters?.limit || 60);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 60, 1), 100);
    const query =
      `${SUPABASE_URL}/rest/v1/credit_audit` +
      `?user_id=eq.${encodeURIComponent(user.id)}` +
      `&select=*` +
      `&order=id.desc` +
      `&limit=${limit}`;

    const auditRes = await fetch(query, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!auditRes.ok) {
      const body = await auditRes.text().catch(() => '');
      console.error('credit_audit_query_failed', auditRes.status, body);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'credit_audit_query_failed' })
      };
    }

    const rows = await auditRes.json();

    const cleanRows = (Array.isArray(rows) ? rows : []).map((row) => {
      const oldCredits = Number(row.old_credits ?? 0);
      const newCredits = Number(row.new_credits ?? 0);
      const rawDelta = row.delta ?? (newCredits - oldCredits);
      const delta = Number(rawDelta || 0);

      const cleanDelta = Number.isFinite(delta) ? delta : 0;
      const label = row.reason || row.action || row.description ||
        (cleanDelta > 0 ? 'Credits added' : cleanDelta < 0 ? 'Credits used' : 'Balance updated');

      return {
        id: row.id ?? null,
        old_credits: Number.isFinite(oldCredits) ? oldCredits : 0,
        new_credits: Number.isFinite(newCredits) ? newCredits : 0,
        delta: cleanDelta,
        label,
        changed_at: row.changed_at || row.created_at || row.inserted_at || row.updated_at || null
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ rows: cleanRows })
    };
  } catch (error) {
    console.error('credit_history_error', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'credit_history_error' })
    };
  }
};
