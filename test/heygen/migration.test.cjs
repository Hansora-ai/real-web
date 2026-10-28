const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Fixtures follow HeyGen's current create-avatar, create-video, get-avatar-look,
// get-video and webhook-events docs. No real API calls or credit spending.
function fixture(options = {}) {
  let row = options.row ? structuredClone(options.row) : null;
  let balance = 20, debits = 0, refunds = 0;
  const calls = [];
  const state = { look: 'processing', video: 'waiting', ...options };
  const copy = value => structuredClone(value);
  const fetch = async (raw, init = {}) => {
    const url = new URL(raw), method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: url.href, method, body, headers: init.headers });
    if (url.hostname === 'database.test') {
      if (url.pathname === '/auth/v1/user') return Response.json({ id: init.headers.Authorization === 'Bearer owner-token' ? 'owner' : 'someone-else' });
      if (url.pathname.endsWith('/profiles')) {
        if (method === 'PATCH') {
          if (body.credits < balance) debits++;
          if (body.credits > balance) refunds++;
          balance = body.credits;
        }
        return Response.json([{ credits: balance }]);
      }
      if (url.pathname.includes('/storage/v1/object/')) return Response.json({ ok: true });
      assert.ok(url.pathname.endsWith('/user_generations'), raw);
      if (method === 'POST') row = { id: 'generation', ...copy(body) };
      if (method === 'PATCH') {
        for (const [key, filter] of url.searchParams) {
          if (!key.startsWith('meta->>')) continue;
          const value = row?.meta?.[key.slice(7)];
          if (filter === 'is.null' && value != null) return Response.json([]);
          if (filter.startsWith('eq.') && String(value) !== filter.slice(3)) return Response.json([]);
        }
        if (row) Object.assign(row, copy(body));
      }
      return Response.json(row ? [copy(row)] : []);
    }
    if (url.hostname === 'delivery.test') {
      const bytes = Buffer.alloc(24);
      bytes.write('ftyp', 4); bytes.write('isom', 8);
      return new Response(bytes, { headers: { 'content-type': 'video/mp4' } });
    }
    assert.equal(url.hostname, 'api.heygen.com');
    assert.ok(url.pathname.startsWith('/v3/'), 'no legacy HeyGen requests');
    assert.equal(init.headers['x-api-key'], 'test-provider');
    if (url.pathname === '/v3/avatars') {
      if (state.createResponse) return state.createResponse();
      return Response.json({ data: { avatar_item: { id: 'look-fixture', status: 'processing' }, avatar_group: { id: 'group-fixture' } } });
    }
    if (url.pathname === '/v3/avatars/looks/look-fixture') {
      if (state.lookResponse) return state.lookResponse();
      return Response.json({ data: { id: 'look-fixture', status: state.look, supported_api_engines: state.engines || ['avatar_iv', 'avatar_iii'], error: state.lookError || null } });
    }
    if (url.pathname === '/v3/videos' && method === 'POST') {
      if (state.submitResponse) return state.submitResponse();
      return Response.json({ data: { video_id: 'video-fixture', status: 'waiting' } });
    }
    assert.equal(url.pathname, '/v3/videos/video-fixture');
    if (state.videoResponse) return state.videoResponse();
    return Response.json({ data: { id: 'video-fixture', status: state.video,
      video_url: state.videoUrl || (state.video === 'completed' ? 'https://delivery.test/result.mp4' : null),
      failure_message: state.failureMessage || null } });
  };
  const load = name => {
    const exports = {};
    const context = { exports, Buffer, URL, Response, AbortSignal, console,
      process: { env: { HEYGEN_API_KEY: 'test-provider', SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' } },
      fetch, require: name => name === './run-heygen-avatar.js' ? launcher : require(name) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../netlify/functions', name), 'utf8'), context, { filename: name });
    return exports;
  };
  const launcher = load('run-heygen-avatar.js'), checker = load('heygen-check.js');
  return { state, calls, get row() { return row; }, get balance() { return balance; }, get debits() { return debits; }, get refunds() { return refunds; },
    async submit(model = 'avatar_iii', extra = {}) {
      const response = await launcher.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer owner-token' }, body: JSON.stringify({ uid: 'owner', run_id: 'run-fixture', model,
        imageUrl: 'https://uploads.test/portrait.png', audioUrl: 'https://uploads.test/audio.mp3', duration_seconds: 5.2, ...extra }) });
      return JSON.parse(response.body);
    },
    async poll(headers = { Authorization: 'Bearer owner-token' }, extra = {}) {
      return JSON.parse((await checker.handler({ httpMethod: 'GET', headers,
        queryStringParameters: { uid: 'owner', run_id: 'run-fixture' }, ...extra })).body);
    }
  };
}

test('Avatar IV keeps image/audio v3 generation and its rounded duration price', async () => {
  const f = fixture(), result = await f.submit('avatar_v');
  assert.equal(result.submitted, true); assert.equal(result.cost, 4.2);
  assert.equal(f.debits, 1); assert.equal(f.row.meta.provider_api, 'v3');
  const call = f.calls.find(c => c.method === 'POST' && c.url.endsWith('/v3/videos'));
  assert.equal(call.body.type, 'image'); assert.equal(call.body.image.url, 'https://uploads.test/portrait.png');
  assert.equal(call.body.audio_url, 'https://uploads.test/audio.mp3');
  assert.equal(call.body.resolution, '1080p');
  assert.equal(f.calls.filter(c => c.url.includes('/v3/avatars')).length, 0);
});

test('Avatar III persists its photo look, waits without charging, then renders and archives via v3', async () => {
  const f = fixture(), pending = await f.submit();
  assert.equal(pending.submitted, true); assert.equal(pending.pending, true); assert.equal(f.debits, 0);
  assert.equal(f.row.meta.avatar_id, 'look-fixture');
  const photo = f.calls.find(c => c.url.endsWith('/v3/avatars'));
  assert.equal(photo.body.type, 'photo'); assert.deepEqual(photo.body.file, { type: 'url', url: 'https://uploads.test/portrait.png' });
  assert.equal((await f.poll()).status, 'pending'); assert.equal(f.debits, 0);
  f.state.look = 'completed';
  assert.equal((await f.poll()).status, 'pending'); assert.equal(f.debits, 1);
  assert.equal(f.balance, 18.2); assert.equal(f.row.meta.task_id, 'video-fixture');
  assert.equal(f.row.meta.avatar_create_response.data.avatar_item.id, 'look-fixture');
  const render = f.calls.find(c => c.method === 'POST' && c.url.endsWith('/v3/videos'));
  assert.equal(render.body.type, 'avatar'); assert.equal(render.body.avatar_id, 'look-fixture');
  assert.deepEqual(render.body.engine, { type: 'avatar_iii' });
  assert.equal(render.body.audio_url, 'https://uploads.test/audio.mp3');
  assert.equal(render.body.aspect_ratio, '9:16'); assert.equal(render.body.resolution, '1080p');
  assert.equal(render.body.callback_id, 'run-fixture');
  for (const field of ['video_inputs', 'dimension', 'avatar_engine', 'motion_prompt', 'expressiveness']) assert.equal(field in render.body, false);
  f.state.video = 'completed';
  const done = await f.poll(); assert.equal(done.status, 'done');
  assert.match(done.result_url, /storage\/v1\/object\/public\/generation-history\/owner\/generation.mp4$/);
  assert.equal(f.row.meta.archive_validated_video, true);
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/avatars')).length, 1);
  assert.equal((await f.submit()).already, true); assert.equal(f.debits, 1);
});

test('unauthenticated or wrong-user polls cannot resume a paid generation', async () => {
  const f = fixture(); await f.submit(); f.state.look = 'completed';
  assert.equal((await f.poll({})).status, 'pending');
  assert.equal((await f.poll({ authorization: 'Bearer wrong-token' })).status, 'pending');
  assert.equal(f.row.meta.status, 'processing'); assert.equal(f.debits, 0);
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/videos')).length, 0);
});

test('overlapping authenticated polls submit and charge once', async () => {
  const f = fixture(); await f.submit(); f.state.look = 'completed';
  let release, started;
  const arrived = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  f.state.lookResponse = async () => { started(); await wait; return Response.json({ data: { status: 'completed', supported_api_engines: ['avatar_iii'] } }); };
  const first = f.poll(); await arrived;
  assert.equal((await f.poll()).status, 'pending'); release(); await first;
  assert.equal(f.debits, 1);
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/videos')).length, 1);
});

test('a saved look survives a transient status error and resumes with original inputs', async () => {
  const f = fixture({ lookResponse: () => new Response('', { status: 503 }) });
  assert.equal((await f.submit()).pending, true); assert.equal(f.debits, 0);
  f.state.lookResponse = null; f.state.look = 'completed';
  await f.submit('avatar_v', { imageUrl: 'https://uploads.test/changed.png', duration_seconds: 90 });
  assert.equal(f.debits, 1); assert.equal(f.balance, 18.2);
  assert.equal(f.row.meta.model, 'avatar_iii');
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/avatars')).length, 1);
});

test('failed photo training or unsupported engines never charge or refund uncharged credits', async () => {
  for (const state of [{ look: 'failed', lookError: { message: 'Photo rejected' } }, { look: 'completed', engines: ['avatar_iv'] }]) {
    const f = fixture(state), result = await f.submit();
    assert.equal(result.submitted, false); assert.equal(f.row.meta.status, 'failed');
    assert.equal((await f.poll()).status, 'failed');
    assert.equal(f.debits, 0); assert.equal(f.refunds, 0); assert.equal(f.balance, 20);
  }
});

test('a render failure immediately after resuming refunds the actual debit exactly once', async () => {
  const f = fixture(); await f.submit();
  f.state.look = 'completed'; f.state.video = 'failed'; f.state.failureMessage = 'Renderer failed';
  const result = await f.poll();
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'Renderer failed');
  assert.equal(result.refunded, true); assert.equal(f.debits, 1); assert.equal(f.refunds, 1);
  assert.equal(f.balance, 20); await f.poll(); assert.equal(f.refunds, 1);
});

test('provider HTTP errors do not mark a render failed or refund it', async () => {
  for (const status of [401, 404, 429, 500]) {
    const f = fixture(); await f.submit('avatar_v');
    f.state.videoResponse = () => Response.json({ error: { code: 'temporary', message: 'Try again' } }, { status });
    assert.equal((await f.poll()).status, 'pending'); assert.equal(f.refunds, 0);
  }
});

test('legacy jobs use v3 polling; status fields take precedence over error text and URLs', async () => {
  const f = fixture({ row: { id: 'generation', user_id: 'owner', result_url: null,
    meta: { run_id: 'run-fixture', task_id: 'video-fixture', provider_api: 'v2', status: 'processing', charged: true, charged_cost: 1 } } });
  f.state.videoResponse = () => Response.json({ data: { status: 'processing', failure_message: 'Completed an earlier step', video_url: 'https://delivery.test/early.mp4' } });
  assert.equal((await f.poll()).status, 'pending');
  assert.ok(f.calls.some(c => c.url.endsWith('/v3/videos/video-fixture')));
  f.state.videoResponse = null; f.state.video = 'completed'; f.state.failureMessage = 'Previous error resolved';
  f.state.videoUrl = 'https://delivery.test/download?signature=fixture';
  assert.equal((await f.poll()).status, 'done');
});

test('v3 event_data callbacks poll authoritative state instead of trusting callback failure/URL', async () => {
  const f = fixture(); await f.submit('avatar_v'); f.state.video = 'completed';
  const result = await f.poll({}, { httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ event_type: 'avatar_video.fail', event_data: { video_id: 'video-fixture', callback_id: 'run-fixture', url: 'https://untrusted.test/file.mp4' } }) });
  assert.equal(result.status, 'done'); assert.equal(f.refunds, 0);
  assert.equal(f.calls.some(c => c.url.includes('untrusted.test')), false);
});

test('missing provider IDs cannot be mistaken for group/resource IDs or trigger a charge', async () => {
  const photo = fixture({ createResponse: () => Response.json({ data: { avatar_group: { id: 'wrong-group' } } }) });
  assert.equal((await photo.submit()).error, 'missing_avatar_id'); assert.equal(photo.debits, 0);
  const video = fixture({ submitResponse: () => Response.json({ data: { id: 'unrelated-resource' } }) });
  assert.equal((await video.submit('avatar_v')).error, 'missing_video_id'); assert.equal(video.debits, 0);
});

test('all localized pages send owner authorization when polling async photo creation', () => {
  for (const file of ['lipsync.html', 'lipsync_arm.html', 'lipsync_ru.html']) {
    const source = fs.readFileSync(path.join(__dirname, '../../public', file), 'utf8');
    assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
    assert.match(source, /startPollResult\(runId, data.taskId \|\| data.video_id \|\| ''/);
  }
});

test('Avatar IV: a slow HeyGen reply is never shown as a failure, and the next check picks up the same video', async () => {
  const f = fixture();
  f.state.submitResponse = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const first = await f.submit('avatar_v');
  assert.equal(first.submitted, true); assert.equal(first.pending, true); assert.equal(first.status, 'processing');
  assert.equal(f.row.meta.status, 'processing'); assert.equal(f.debits, 0);
  // Soon after, the check does not send it again yet.
  f.row.created_at = new Date(Date.now() - 30 * 1000).toISOString();
  delete f.state.submitResponse;
  assert.equal((await f.poll()).status, 'pending');
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/videos')).length, 1);
  // Later, it sends the same request again; HeyGen answers with its video id and the run is charged once.
  f.row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await f.poll();
  const posts = f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/videos'));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers['Idempotency-Key'], posts[1].headers['Idempotency-Key'], 'same key, so HeyGen returns the same video');
  assert.equal(f.row.meta.video_id, 'video-fixture'); assert.equal(f.debits, 1);
  await f.poll(); await f.poll();
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v3/videos')).length, 2); assert.equal(f.debits, 1);
});

test('Avatar IV: HeyGen busy or briefly down waits instead of failing', async () => {
  for (const status of [429, 503]) {
    const f = fixture();
    f.state.submitResponse = () => Response.json({ error: { message: 'busy' } }, { status });
    const result = await f.submit('avatar_v');
    assert.equal(result.submitted, true, String(status)); assert.equal(result.pending, true);
    assert.equal(f.row.meta.status, 'processing'); assert.equal(f.debits, 0);
  }
});

test('Avatar IV: a run with no video id after 30 minutes is closed as failed and never charged', async () => {
  const f = fixture();
  f.state.submitResponse = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  await f.submit('avatar_v');
  f.row.created_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const result = await f.poll();
  assert.equal(result.status, 'failed'); assert.equal(result.charged, false);
  assert.match(result.error, /Nothing was charged/);
  assert.equal(f.debits, 0); assert.equal(f.refunds, 0);
});
