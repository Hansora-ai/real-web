import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ELEVENLABS_API_KEY = 'provider-key';
process.env.HANSORA_AUDIO_WORKER_SECRET = 'worker-secret';
process.env.AUDIO_WORKER_SECRET = 'worker-secret';

test('ElevenLabs running out of its own quota tells the user plainly, refunds, and logs the real reason', async () => {
  const { default: worker } = await import('../../netlify/functions/audio-eleven-background.mjs');
  let row = { id: 'row-1', user_id: 'user-1', meta: { run_id: 'run-1', status: 'pending', charged: true, refund_amount: 2 } };
  let refunded = 0;
  const logs = [];
  const originalFetch = globalThis.fetch, originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('api.elevenlabs.io')) return new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 47640. You have 240 credits remaining, while 491 credits are required for this request.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    if (href.includes('/profiles')) { if (options.method === 'PATCH') refunded++; return Response.json([{ credits: 10 }]); }
    if (href.includes('/user_generations')) {
      if (options.method === 'PATCH') { const body = JSON.parse(options.body); row = { ...row, ...body, meta: body.meta || row.meta }; }
      return Response.json([row]);
    }
    return Response.json({});
  };
  try {
    await worker(new Request('https://hansora.test/.netlify/functions/audio-eleven-background', {
      method: 'POST', headers: { 'x-hansora-worker-secret': 'worker-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: 'user-1', run_id: 'run-1', kind: 'voice', cost: 2, body: { dialogue: [{ text: 'Hej!', voice: 'JBFqnCBsd6RMkjVDRZzb' }] } })
    }));
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
  assert.equal(row.meta.status, 'failed');
  assert.equal(row.meta.error, 'The voice service is temporarily unavailable. Nothing was charged. Please try again later.');
  assert.ok(refunded >= 1, 'refunded');
  assert.ok(logs.some((line) => line.includes('hansora_elevenlabs_quota') && line.includes('47640')));
});
