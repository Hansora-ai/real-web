import { sha256 } from './crypto.mjs';

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];

function required(name, fallback = '') {
  const value = String(process.env[name] || fallback || '').trim();
  if (!value) { const error = new Error(`missing_${name.toLowerCase()}`); error.status = 503; throw error; }
  return value;
}

export function googleConfig() {
  const site = String(process.env.URL || 'https://hansora.co').replace(/\/$/, '');
  return {
    clientId: required('GOOGLE_AUTOMATION_CLIENT_ID'),
    clientSecret: required('GOOGLE_AUTOMATION_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_AUTOMATION_REDIRECT_URI', `${site}/.netlify/functions/automation-google-callback`)
  };
}

async function googleJson(response, publicError) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(publicError); error.status = response.status >= 500 ? 502 : 400; error.providerStatus = response.status; error.providerError = body?.error; throw error; }
  return body;
}

export function buildGoogleAuthorizationUrl(state) {
  const config = googleConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).toString();
  return url.toString();
}

export async function exchangeGoogleCode(code, fetchImpl = fetch) {
  const config = googleConfig();
  const data = await googleJson(await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(code), client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }).toString() }), 'google_code_exchange_failed');
  if (!data.refresh_token) throw Object.assign(new Error('google_refresh_token_missing'), { status: 400 });
  return { accessToken: String(data.access_token || ''), refreshToken: String(data.refresh_token), expiresIn: Number(data.expires_in || 0) };
}

export async function refreshGoogleAccessToken(refreshToken, fetchImpl = fetch) {
  const config = googleConfig();
  const data = await googleJson(await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: String(refreshToken), client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' }).toString() }), 'google_token_refresh_failed');
  return String(data.access_token || '');
}

export async function listGoogleCalendars(accessToken, fetchImpl = fetch) {
  const data = await googleJson(await fetchImpl('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=100', { headers: { Authorization: `Bearer ${accessToken}` } }), 'google_calendars_unavailable');
  return (Array.isArray(data.items) ? data.items : []).map(item => ({ id: String(item.id), name: String(item.summaryOverride || item.summary || item.id), primary: Boolean(item.primary), timezone: String(item.timeZone || '') }));
}

export async function googleBusyIntervals({ accessToken, calendarId, from, to, fetchImpl = fetch }) {
  const data = await googleJson(await fetchImpl('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: calendarId }] }) }), 'google_freebusy_failed');
  const calendar = data.calendars?.[calendarId] || {};
  if (Array.isArray(calendar.errors) && calendar.errors.length) throw Object.assign(new Error('google_freebusy_failed'), { status: 502, providerError: calendar.errors });
  return (Array.isArray(calendar.busy) ? calendar.busy : []).map(item => ({ start: Date.parse(item.start), end: Date.parse(item.end) })).filter(item => item.end > item.start);
}

// Google accepts client-chosen event ids (base32hex); a hash of our idempotency key makes retries harmless.
export function googleEventId(idempotencyKey) { return `hs${sha256(idempotencyKey).slice(0, 40)}`; }

export async function createGoogleEvent({ accessToken, calendarId, idempotencyKey, summary, description, start, end, timezone, fetchImpl = fetch }) {
  const id = googleEventId(idempotencyKey);
  const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, summary: String(summary).slice(0, 300), description: String(description || '').slice(0, 8000), start: { dateTime: new Date(start).toISOString(), timeZone: timezone }, end: { dateTime: new Date(end).toISOString(), timeZone: timezone }, source: { title: 'Hansora Automation', url: 'https://hansora.co/automation-operations.html' } }) });
  if (response.status === 409) return { id, existing: true };
  const data = await googleJson(response, 'google_event_create_failed');
  return { id: String(data.id || id), existing: false };
}

export async function cancelGoogleEvent({ accessToken, calendarId, eventId, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404 || response.status === 410 || response.ok) return true;
  await googleJson(response, 'google_event_cancel_failed');
  return false;
}
