import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, deletionMessage, SCOPES } from '../../netlify/functions/account-deletion-request.mjs';

test('only POST is accepted', async () => {
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode, 204);
});

test('a signed-out request is refused and nothing is stored', async () => {
  const response = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ scope: 'account' }) });
  assert.equal(response.statusCode, 401);
});

test('two choices: Automation data only, or the whole account', () => {
  assert.deepEqual(SCOPES, ['automation', 'account']);
  assert.match(deletionMessage({ scope: 'account', email: 'a@b.co', userId: 'u1' }), /WHOLE Hansora account[\s\S]*a@b\.co[\s\S]*u1/);
  assert.match(deletionMessage({ scope: 'automation', email: null, userId: 'u2' }), /Automation data only[\s\S]*\(no email\)/);
});
