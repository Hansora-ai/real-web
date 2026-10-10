import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { extractTikTokEvents, readTikTokMessage, readTikTokState, signTikTokState, tiktokAuthorizationUrl, tiktokSignatureState, sendTikTokText } from '../../lib/automation/tiktok.mjs';

test('TikTok webhook: finds the business and conversation in any nesting, also inside JSON strings', () => {
  const nested = { event: 'DIRECT_MESSAGE', user_openid: 'biz-1', content: JSON.stringify({ conversation_id: 'conv-1', message_id: 'm-1' }) };
  assert.deepEqual(extractTikTokEvents(nested), [{ businessId: 'biz-1', conversationId: 'conv-1', messageId: 'm-1' }]);
  const byRole = { data: [{ conversation_id: 'conv-2', message_id: 'm-2', to_user: { id: 'biz-2', role: 'BUSINESS_ACCOUNT' }, from_user: { id: 'cust', role: 'PERSONAL_ACCOUNT' } }] };
  assert.deepEqual(extractTikTokEvents(byRole), [{ businessId: 'biz-2', conversationId: 'conv-2', messageId: 'm-2' }]);
  assert.deepEqual(extractTikTokEvents({ hello: 'world' }), []);
  assert.deepEqual(extractTikTokEvents('not json'), []);
});

test('TikTok message: customer and business sides, media and shared posts', () => {
  const customer = readTikTokMessage({ message_id: 'm1', conversation_id: 'c1', message_type: 'TEXT', text: { body: 'Hi' }, from_user: { id: 'u1', role: 'PERSONAL_ACCOUNT', display_name: 'Ani', profile_image: 'https://p/1.jpg' }, timestamp: 1760000000000 });
  assert.equal(customer.fromBusiness, false); assert.equal(customer.customerId, 'u1'); assert.equal(customer.customerName, 'Ani'); assert.equal(customer.text, 'Hi'); assert.equal(customer.timestamp, 1760000000000);
  const team = readTikTokMessage({ message_id: 'm2', message_type: 'TEXT', text: { body: 'Hello' }, from_user: { id: 'b', role: 'BUSINESS_ACCOUNT' }, to_user: { id: 'u1', display_name: 'Ani' } });
  assert.equal(team.fromBusiness, true); assert.equal(team.customerId, 'u1'); assert.equal(team.customerName, 'Ani');
  const photo = readTikTokMessage({ message_id: 'm3', message_type: 'IMAGE', image: { media_id: 'media-9' }, from_user: { id: 'u1' } });
  assert.equal(photo.mediaId, 'media-9'); assert.equal(photo.type, 'IMAGE');
  assert.equal(readTikTokMessage({ message_type: 'SHARE_POST', share_post: { embed_url: 'https://tiktok.com/x' } }).postUrl, 'https://tiktok.com/x');
  assert.equal(readTikTokMessage({ auto_message_type: 'WELCOME' }).automatic, true);
});

test('TikTok webhook signature: missing is allowed, correct is valid, wrong is rejected', () => {
  const body = '{"a":1}', t = '1760000000';
  const s = crypto.createHmac('sha256', 'secret').update(`${t}.${body}`).digest('hex');
  assert.equal(tiktokSignatureState(body, '', 'secret'), 'absent');
  assert.equal(tiktokSignatureState(body, `t=${t},s=${s}`, 'secret'), 'valid');
  assert.equal(tiktokSignatureState(body, `t=${t},s=${'0'.repeat(64)}`, 'secret'), 'invalid');
  assert.equal(tiktokSignatureState('{"a":2}', `t=${t},s=${s}`, 'secret'), 'invalid');
});

test('TikTok connect state is signed, tamper-proof and expires', () => {
  const state = signTikTokState({ businessId: 'b1', userId: 'u1' }, 'k');
  assert.deepEqual(readTikTokState(state, 'k'), { businessId: 'b1', userId: 'u1' });
  assert.equal(readTikTokState(state, 'other'), null);
  const [body, mac] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), b: 'b2' })).toString('base64url');
  assert.equal(readTikTokState(`${forged}.${mac}`, 'k'), null);
  const expired = Buffer.from(JSON.stringify({ b: 'b1', u: 'u1', e: Date.now() - 1 })).toString('base64url');
  assert.equal(readTikTokState(`${expired}.${crypto.createHmac('sha256', 'k').update(expired).digest('base64url')}`, 'k'), null);
});

test('TikTok authorization link and sending a reply', async () => {
  const old = { ...process.env };
  process.env.TIKTOK_APP_ID = 'app1'; process.env.TIKTOK_APP_SECRET = 's';
  process.env.TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize?client_key=app1&scope=user.info.basic';
  try {
    const url = new URL(tiktokAuthorizationUrl({ redirectUri: 'https://hansora.co/cb', state: 'st' }));
    assert.equal(url.searchParams.get('redirect_uri'), 'https://hansora.co/cb'); assert.equal(url.searchParams.get('state'), 'st'); assert.equal(url.searchParams.get('app_id'), null);
    let sent;
    const fetchImpl = async (target, options) => { sent = { target: String(target), options }; return { ok: true, status: 200, json: async () => ({ code: 0, data: { message: { message_id: 'out-1' } } }) }; };
    const result = await sendTikTokText({ businessId: 'biz', conversationId: 'conv', text: 'Thanks!', token: 'tok', fetchImpl });
    assert.equal(result.messageId, 'out-1');
    assert.match(sent.target, /business\/message\/send\/$/); assert.equal(sent.options.headers['Access-Token'], 'tok');
    assert.deepEqual(JSON.parse(sent.options.body), { business_id: 'biz', recipient_type: 'CONVERSATION', recipient: 'conv', message_type: 'TEXT', text: { body: 'Thanks!' } });
    const failing = async () => ({ ok: true, status: 200, json: async () => ({ code: 40001, message: 'outside window' }) });
    await assert.rejects(sendTikTokText({ businessId: 'biz', conversationId: 'conv', text: 'x', token: 'tok', fetchImpl: failing }), /tiktok_request_failed/);
  } finally { process.env = old; }
});
