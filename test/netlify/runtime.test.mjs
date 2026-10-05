import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { withLegacyHandler } from '../../lib/netlify/legacy-handler.mjs';
import { handler as metaWebhook } from '../../netlify/functions/automation-meta-webhook.mjs';
import { handler as comments } from '../../netlify/functions/automation-instagram-comment-process-background.mjs';

const context = { requestId: 'test-request' };

test('adapter keeps signed JSON bytes, authorization, URL and repeated query values', async () => {
  const body = '{ "message": "Բարև", "value": 1 }';
  const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
  const handler = withLegacyHandler(async event => {
    assert.equal(event.body, body);
    assert.equal(event.isBase64Encoded, false);
    assert.equal(event.headers.authorization, 'Bearer test-token');
    assert.equal(event.headers['x-hub-signature-256'], signature);
    assert.equal(event.rawUrl, 'https://hansora.co/.netlify/functions/test?item=a&item=b');
    assert.deepEqual(event.multiValueQueryStringParameters.item, ['a', 'b']);
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' };
  });
  const response = await handler(new Request('https://hansora.co/.netlify/functions/test?item=a&item=b', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token', 'x-hub-signature-256': signature }, body
  }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('adapter preserves binary upload bytes and binary download responses', async () => {
  const bytes = Buffer.from([0, 255, 65, 13, 10]);
  const handler = withLegacyHandler(async event => {
    assert.equal(event.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(event.body, 'base64'), bytes);
    return { statusCode: 200, headers: { 'content-type': 'application/octet-stream' }, body: event.body, isBase64Encoded: true };
  });
  const response = await handler(new Request('https://hansora.co/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: bytes }), context);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('adapter supports existing empty OPTIONS responses and multiple cookies', async () => {
  const handler = withLegacyHandler(async () => ({ statusCode: 204, body: '{}', headers: { 'access-control-allow-origin': '*' }, multiValueHeaders: { 'Set-Cookie': ['one=1; Path=/', 'two=2; Path=/'] } }));
  const response = await handler(new Request('https://hansora.co/test', { method: 'OPTIONS' }), context);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.getSetCookie().length, 2);
});

test('real Meta webhook still rejects unsigned deliveries and wrong HTTP methods', async () => {
  const handler = withLegacyHandler(metaWebhook);
  const response = await handler(new Request('https://hansora.co/.netlify/functions/automation-meta-webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"object":"instagram"}' }), context);
  assert.equal(response.status, 401);
  assert.equal(await response.text(), 'invalid signature');
  assert.equal((await handler(new Request('https://hansora.co/webhook', { method: 'PUT' }), context)).status, 405);
});

test('real comment processor still requires internal authentication before processing', async () => {
  const handler = withLegacyHandler(comments);
  const response = await handler(new Request('https://hansora.co/.netlify/functions/automation-instagram-comment-process-background', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), context);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('real Meta verification and a signed delivery still succeed through the adapter', async () => {
  const values = {
    META_INSTAGRAM_APP_ID: 'test-app', META_INSTAGRAM_APP_SECRET: 'test-secret',
    META_INSTAGRAM_REDIRECT_URI: 'https://hansora.co/callback',
    META_WEBHOOK_VERIFY_TOKEN: 'test-verify', HANSORA_AUTOMATION_OAUTH_SECRET: 'test-oauth'
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const handler = withLegacyHandler(metaWebhook);
    const verification = await handler(new Request('https://hansora.co/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=123'), context);
    assert.equal(verification.status, 200);
    assert.equal(await verification.text(), '123');
    const body = '{ "object": "instagram", "entry": [] }';
    const signature = 'sha256=' + crypto.createHmac('sha256', values.META_INSTAGRAM_APP_SECRET).update(body).digest('hex');
    const delivery = await handler(new Request('https://hansora.co/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body }), context);
    assert.equal(delivery.status, 200);
    assert.equal(await delivery.text(), 'EVENT_RECEIVED');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
