import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
const BUSINESS = '11111111-1111-4111-8111-111111111111';
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace('https://example.supabase.co', '');
  calls.push(`${options.method || 'GET'} ${path.split('?')[0]}`);
  const reply = body => new Response(body === null ? null : JSON.stringify(body), { status: body === null ? 204 : 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/auth/v1/user') return reply({ id: 'owner-1' });
  if (path.startsWith('/rest/v1/automation_businesses') && (options.method || 'GET') === 'GET') return reply(path.includes('owner_user_id=eq.owner-1') ? [{ id: BUSINESS, name: 'Demo Bakery' }] : []);
  if (path.startsWith('/rest/v1/automation_phone_sip_trunks')) return reply([]);
  return reply(null);
};
const { handler } = await import('../../netlify/functions/automation-business-delete.mjs');
const run = body => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) });

test('refuses when the typed name does not match', async () => {
  calls.length = 0;
  const response = await run({ business_id: BUSINESS, confirm_name: 'Other' });
  assert.equal(response.statusCode, 400);
  assert.ok(!calls.some(call => call.startsWith('DELETE')));
});

test('turns off phone numbers, then deletes the AI employee', async () => {
  calls.length = 0;
  const response = await run({ business_id: BUSINESS, confirm_name: ' demo bakery ' });
  assert.equal(response.statusCode, 200);
  const release = calls.indexOf('POST /rest/v1/rpc/automation_release_phone_number');
  const remove = calls.indexOf('DELETE /rest/v1/automation_businesses');
  assert.ok(release >= 0 && remove > release);
});

test('requires login', async () => {
  const response = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(response.statusCode, 401);
});
