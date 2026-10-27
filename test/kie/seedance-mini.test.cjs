const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
process.env.KIE_API_KEY = 'test-provider';
const { handler } = require('../../netlify/functions/run-seedance-2-mini.js');

// Supabase and KIE are simulated; records what reaches KIE and whether anything was charged.
function world(provider = () => Response.json({ code: 200, data: { taskId: 'accepted-task' } })) {
  const sent = [];
  let debits = 0;
  const fetchMock = async (raw, options = {}) => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'fixture-user' });
    if (url.hostname === 'api.kie.ai') { sent.push(JSON.parse(options.body)); return provider(); }
    if (url.pathname.endsWith('/profiles')) { if (options.method === 'PATCH') debits++; return Response.json([{ credits: 100 }]); }
    if (url.pathname.includes('/rpc/')) { debits++; return Response.json({ ok: true, credits: 90 }); }
    return Response.json([{ id: 'fixture-row', meta: {} }]);
  };
  return { sent, get debits() { return debits; }, fetchMock };
}
async function run(mock, body) {
  const original = global.fetch;
  global.fetch = mock.fetchMock;
  try {
    const result = await handler({ httpMethod: 'POST', headers: { 'x-user-id': 'fixture-user', authorization: 'Bearer token' },
      body: JSON.stringify({ run_id: 'fixture-run', resolution: '720p', duration: 5, ...body }) });
    return { status: result.statusCode, body: JSON.parse(result.body) };
  } finally { global.fetch = original; }
}

test('Seedance 2.0 Mini refuses an over-long prompt before anything starts, in words the user can read', async () => {
  const mock = world();
  const result = await run(mock, { prompt: 'x'.repeat(23556) });
  assert.equal(result.status, 400);
  assert.equal(result.body.error_code, 'prompt_too_long');
  assert.match(result.body.error, /accepts prompts up to 20,000 characters; this one has 23,556\. Please shorten it/);
  assert.equal(mock.sent.length, 0);
  assert.equal(mock.debits, 0);
});

test('KIE\'s own "text length" refusal is reported the same readable way', async () => {
  const mock = world(() => Response.json({ code: 500, msg: 'The text length cannot exceed the maximum limit' }));
  const result = await run(mock, { prompt: 'A long but allowed prompt' });
  assert.equal(result.body.error_code, 'prompt_too_long');
  assert.equal(mock.debits, 0);
});

test('web search is sent only for text-to-video, which is all KIE allows', async () => {
  const textOnly = world();
  await run(textOnly, { prompt: 'News about the eclipse', enable_web_search: true });
  assert.equal(textOnly.sent[0].input.web_search, true);
  const withImages = world();
  await run(withImages, { prompt: 'Dooku fights Anakin', enable_web_search: true, reference_image_urls: ['https://uploads.test/a.png', 'https://uploads.test/b.png'] });
  assert.equal(withImages.sent[0].input.web_search, false);
  assert.equal(withImages.sent[0].input.reference_image_urls.length, 2);
  const withFrame = world();
  await run(withFrame, { prompt: 'She waves', web_search: true, first_frame_url: 'https://uploads.test/a.png' });
  assert.equal(withFrame.sent[0].input.web_search, false);
});
