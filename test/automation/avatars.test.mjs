import test from 'node:test';
import assert from 'node:assert/strict';
import { isKeptAvatar, keepAvatar } from '../../lib/automation/avatars.mjs';

const BUSINESS = '91d60a86-ad96-4ea7-b96d-30ed16f8a94b';
function withEnv(run) {
  return async () => {
    const old = { ...process.env };
    process.env.SUPABASE_URL = 'https://db.example.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    try { await run(); } finally { process.env = old; }
  };
}

test('customer photo: Hansora keeps its own copy and links to it', withEnv(async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('{}', { status: 200 });
  };
  const kept = await keepAvatar({ url: 'https://scontent.cdninstagram.com/p.jpg?oe=1', businessId: BUSINESS, channel: 'instagram', customerId: '1789', fetchImpl });
  assert.match(kept, new RegExp(`^https://db\\.example\\.co/storage/v1/object/public/automation-avatars/${BUSINESS}/instagram-[0-9a-f]{32}\\.jpg\\?v=`));
  assert.equal(isKeptAvatar(kept), true);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['x-upsert'], 'true');
  assert.equal(calls[1].url.includes('1789'), false, 'the customer id is not in the public file name');
  // Already kept: nothing is downloaded again.
  assert.equal(await keepAvatar({ url: kept, businessId: BUSINESS, channel: 'instagram', customerId: '1789', fetchImpl }), kept);
  assert.equal(calls.length, 2);
}));

test('customer photo: anything that is not a small image keeps the original link', withEnv(async () => {
  const html = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  assert.equal(await keepAvatar({ url: 'https://x.example/p', businessId: BUSINESS, channel: 'instagram', customerId: '1', fetchImpl: html }), 'https://x.example/p');
  const failed = async () => { throw new Error('timeout'); };
  assert.equal(await keepAvatar({ url: 'https://x.example/p', businessId: BUSINESS, channel: 'instagram', customerId: '1', fetchImpl: failed }), 'https://x.example/p');
  assert.equal(await keepAvatar({ url: 'http://x.example/p', businessId: BUSINESS, channel: 'instagram', customerId: '1' }), '');
  assert.equal(isKeptAvatar('https://scontent.cdninstagram.com/p.jpg'), false);
}));

test('Telegram photo: the smallest size of at least 160 px is copied', withEnv(async () => {
  const { telegramProfilePhotoUrl } = await import('../../lib/automation/telegram.mjs');
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '123:abc';
  const asked = [];
  const fetchImpl = async (url, options) => {
    const method = String(url).split('/').pop(); asked.push({ method, body: JSON.parse(options.body) });
    if (method === 'getUserProfilePhotos') return new Response(JSON.stringify({ ok: true, result: { photos: [[{ file_id: 'small', width: 160 }, { file_id: 'big', width: 640 }]] } }));
    return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.jpg' } }));
  };
  const url = await telegramProfilePhotoUrl('42', fetchImpl);
  assert.match(url, /\/file\/bot.+\/photos\/file_1\.jpg$/);
  assert.deepEqual(asked.map(item => item.method), ['getUserProfilePhotos', 'getFile']);
  assert.equal(asked[1].body.file_id, 'small');
}));
