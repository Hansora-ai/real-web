import crypto from 'node:crypto';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
const COOKIE_NAME = 'hansora_sales_anon';

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function parseCookies(raw) {
  const output = {};
  String(raw || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 1) return;
    output[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return output;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function authenticateRequest(event) {
  const authorization = String(header(event, 'authorization')).trim();
  if (!authorization) return null;
  const token = (authorization.match(/^Bearer\s+(.+)$/i) || [])[1] || '';
  if (!token || !SUPABASE_URL || !SERVICE_KEY) {
    const error = new Error('invalid_authentication');
    error.status = 401;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: controller.signal,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const error = new Error('invalid_authentication');
      error.status = 401;
      throw error;
    }
    const user = await response.json();
    if (!user?.id) throw new Error('invalid_authentication');
    return { id: String(user.id), email: user.email || null };
  } finally {
    clearTimeout(timeout);
  }
}

export function anonymousIdentity(event) {
  const cookies = parseCookies(header(event, 'cookie'));
  const existing = /^[a-f0-9]{64}$/i.test(cookies[COOKIE_NAME] || '') ? cookies[COOKIE_NAME] : '';
  const secret = existing || crypto.randomBytes(32).toString('hex');
  return {
    secret,
    secretHash: sha256(secret),
    setCookie: existing ? null : `${COOKIE_NAME}=${encodeURIComponent(secret)}; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Lax`
  };
}

export function requestIpHash(event) {
  const ip = String(header(event, 'x-nf-client-connection-ip') || header(event, 'x-forwarded-for')).split(',')[0].trim();
  const salt = process.env.SALES_AGENT_RATE_LIMIT_SALT || SERVICE_KEY.slice(-32);
  return sha256(`${salt}:${ip || 'unknown'}`);
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
