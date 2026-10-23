import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { default: hansoraMcp } = await import('../../netlify/functions/hansora-mcp.mjs');

const tokenFor = (claims) => `x.${Buffer.from(JSON.stringify({ client_id: 'chatgpt', sub: 'user-9', ...claims })).toString('base64url')}.y`;

async function connect(token, authStatus) {
  const logged = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/auth/v1/user')) return new Response('{}', { status: authStatus });
    if (href.endsWith('/rest/v1/chatgpt_events')) { logged.push(JSON.parse(options.body)); return new Response(null, { status: 201 }); }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const response = await hansoraMcp(new Request('https://hansora.test/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    }));
    return { status: response.status, logged };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('a login Hansora rejects is recorded, so "internal error" from a broken connection is visible', async () => {
  const live = await connect(tokenFor({ exp: Math.floor(Date.now() / 1000) + 3600 }), 401);
  assert.equal(live.status, 401);
  assert.deepEqual([live.logged[0].user_id, live.logged[0].tool, live.logged[0].outcome], ['user-9', 'connection', 'login_rejected']);

  const expired = await connect(tokenFor({ exp: Math.floor(Date.now() / 1000) - 60 }), 401);
  assert.equal(expired.logged[0].outcome, 'token_expired');

  const down = await connect(tokenFor({ exp: Math.floor(Date.now() / 1000) + 3600 }), 503);
  assert.equal(down.status, 503);
  assert.equal(down.logged[0].outcome, 'auth_unavailable');
});
