import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentDispatchClient, TokenVerifier } from 'livekit-server-sdk';

process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.LIVEKIT_URL = 'wss://voice.test';
process.env.LIVEKIT_API_KEY = 'test-livekit-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret-with-enough-characters';
const { handler } = await import('../../netlify/functions/automation-phone-token.mjs');
const id = '123e4567-e89b-42d3-a456-426614174000';

test('any owner can test their own configured employee without a number or credit balance', async t => {
  const originalFetch = globalThis.fetch;
  const originalDispatch = AgentDispatchClient.prototype.createDispatch;
  let dispatch;
  const paths = [];
  globalThis.fetch = async url => {
    paths.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id:'new-owner' });
    assert.match(String(url), /owner_user_id=eq.new-owner/);
    return Response.json([{ id, name:'New business', automation_agents:[{id:'agent'}], automation_business_knowledge:[{id:'knowledge'}] }]);
  };
  AgentDispatchClient.prototype.createDispatch = async (room, name, options) => { dispatch = {room,name,metadata:JSON.parse(options.metadata)}; return {}; };
  t.after(() => { globalThis.fetch = originalFetch; AgentDispatchClient.prototype.createDispatch = originalDispatch; });
  const result = await handler({ httpMethod:'POST', headers:{authorization:'Bearer test-owner-token'}, body:JSON.stringify({business_id:id,settings:{greeting:'Hello!',transfer_number:'+15550100000'}}) });
  assert.equal(result.statusCode, 200);
  const payload = JSON.parse(result.body);
  const claims = await new TokenVerifier(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET).verify(payload.token);
  assert.equal(claims.sub, dispatch.metadata.participant_identity);
  assert.equal(claims.video.room, dispatch.room);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.equal(dispatch.metadata.business_id, id);
  assert.equal(dispatch.metadata.owner_user_id, 'new-owner');
  assert.equal(dispatch.metadata.direction, 'test');
  assert.equal(dispatch.metadata.test_settings.greeting, 'Hello!');
  assert.equal(dispatch.metadata.test_settings.transfer_number, undefined);
  assert.equal(payload.max_seconds, 300);
  assert.equal(paths.length, 2); // No phone-number or profiles.credits lookup.
});

test('another account cannot dispatch a test for someone else’s business', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/auth/v1/user') ? Response.json({id:'other-owner'}) : Response.json([]);
  t.after(() => { globalThis.fetch = original; });
  const result = await handler({httpMethod:'POST',headers:{authorization:'Bearer other-token'},body:JSON.stringify({business_id:id})});
  assert.equal(result.statusCode, 404);
});

test('a new account must finish creating an employee before voice testing', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/auth/v1/user') ? Response.json({id:'new-owner'}) : Response.json([{id,name:'Draft',automation_agents:[],automation_business_knowledge:[]}]);
  t.after(() => { globalThis.fetch = original; });
  const result = await handler({httpMethod:'POST',headers:{authorization:'Bearer owner-token'},body:JSON.stringify({business_id:id})});
  assert.equal(result.statusCode, 409);
});
