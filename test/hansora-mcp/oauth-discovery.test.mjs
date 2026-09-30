import assert from 'node:assert/strict';
import test from 'node:test';
import hansoraMcp from '../../netlify/functions/hansora-mcp.mjs';
import oauthMetadata, { config } from '../../netlify/functions/hansora-mcp-oauth-metadata.mjs';

test('OAuth discovery supports the root fallback and the MCP-specific URL', async () => {
  assert.deepEqual(config.path, [
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource'
  ]);
  for (const path of config.path) {
    const response = await oauthMetadata(new Request(`https://hansora.co${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const metadata = await response.json();
    assert.equal(metadata.resource, 'https://hansora.co/mcp');
    assert.deepEqual(metadata.authorization_servers, ['https://qmaealblegvcwodlmeht.supabase.co/auth/v1']);
  }
});

test('Unauthenticated MCP clients can read the OAuth challenge across origins', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await hansoraMcp(new Request('https://hansora.co/mcp', { method }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-expose-headers'), /WWW-Authenticate/);
    assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/hansora.co\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
