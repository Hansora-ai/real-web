const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parse } = require('acorn');
process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
process.env.KIE_API_KEY = 'test-provider';
const { acceptedTaskId } = require('../../lib/kie/submission.cjs');

test('KIE task IDs require a real string and a successful application response', () => {
  for (const data of [null, {}, { code: 422, data: { taskId: 'task-1' } },
    { data: { taskId: '  ' } }, { taskId: 'null' }, { taskId: 'undefined' }, { taskId: 17 }]) {
    assert.equal(acceptedTaskId(data), null);
  }
  assert.equal(acceptedTaskId({ code: '200', data: { taskId: 'task-1' } }), 'task-1');
  assert.equal(acceptedTaskId({ taskId: ' task-2 ' }), 'task-2');
});

function launcherMock(provider) {
  let row, balance = 10, debits = 0;
  return { get row() { return row; }, get balance() { return balance; }, get debits() { return debits; },
    async fetch(raw, options = {}) {
      const url = new URL(raw), body = options.body ? JSON.parse(options.body) : null;
      if (url.hostname === 'api.kie.ai') return provider();
      if (url.pathname.endsWith('/profiles')) {
        if (options.method === 'PATCH') { balance = body.credits; debits++; }
        return Response.json([{ credits: balance }]);
      }
      assert.ok(url.pathname.endsWith('/user_generations'), raw);
      if (options.method === 'POST') row = { id: 'fixture-row', ...body };
      if (options.method === 'PATCH') Object.assign(row, body);
      return Response.json(row ? [structuredClone(row)] : []);
    }
  };
}

test('all Nano launchers reject HTTP 200 without an accepted task, and never debit', async () => {
  for (const name of ['nano-banana', 'nano-banana-2', 'nano-banana-2-lite', 'nano-banana-pro']) {
    const handler = require(`../../netlify/functions/run-${name}.js`).handler;
    for (const provider of [() => Response.json({ code: 200, data: {} }),
      () => Response.json({ code: 500, msg: 'provider rejected' }),
      () => new Response('not json'), () => Response.json({ code: 200, data: { taskId: ' ' } })]) {
      const mock = launcherMock(provider), original = global.fetch;
      global.fetch = mock.fetch;
      try {
        const result = await handler({ httpMethod: 'POST', headers: { 'x-user-id': 'fixture-user' },
          body: JSON.stringify({ prompt: 'A submarine', run_id: 'fixture-run', resolution: '1K', urls: ['https://uploads.test/reference.png'] }) });
        assert.equal(result.statusCode, 502, name);
        assert.equal(JSON.parse(result.body).submitted, false, name);
        assert.equal(mock.debits, 0, name);
        assert.equal(mock.balance, 10, name);
        assert.equal(mock.row.meta.status, 'failed', name);
      } finally { global.fetch = original; }
    }
    const mock = launcherMock(() => Response.json({ code: 200, data: { taskId: 'accepted-task' } }));
    const original = global.fetch;
    global.fetch = mock.fetch;
    try {
      const result = await handler({ httpMethod: 'POST', headers: { 'x-user-id': 'fixture-user' },
        body: JSON.stringify({ prompt: 'A submarine', run_id: 'fixture-run', resolution: '1K', urls: ['https://uploads.test/reference.png'] }) });
      assert.equal(result.statusCode, 201, name);
      assert.equal(mock.debits, 1, name);
      assert.equal(mock.row.meta.task_id, 'accepted-task', name);
    } finally { global.fetch = original; }
  }
});

test('checker routes a missing ID through recovery without querying KIE', async () => {
  const checker = require('../../netlify/functions/kie-check.js').handler;
  const original = global.fetch;
  const row = { id: 'fixture-row', user_id: 'fixture-user', result_url: null,
    meta: { run_id: 'fixture-run', task_id: null, status: 'processing', charged: 'true', refund_amount: 0.5 } };
  const calls = [];
  global.fetch = async (raw, options) => {
    calls.push(raw);
    if (raw.includes('/user_generations')) return Response.json([row]);
    assert.ok(raw.endsWith('/rpc/resolve_kie_missing_task'));
    assert.deepEqual(JSON.parse(options.body), { p_generation_id: row.id });
    return Response.json({ status: 'failed', failed: true, refunded: true, refund_amount: 0.5 });
  };
  try {
    const result = await checker({ httpMethod: 'GET', queryStringParameters: { uid: row.user_id, run_id: row.meta.run_id } });
    assert.equal(JSON.parse(result.body).failed, true);
    assert.equal(JSON.parse(result.body).refunded, true);
    assert.equal(calls.length, 2);
  } finally { global.fetch = original; }
});

test('localized history pages recover missing-ID cards and refresh credits', async () => {
  for (const page of ['search-models', 'search-models_arm', 'search-models_ru', 'search-models2']) {
    const html = fs.readFileSync(require.resolve(`../../public/${page}.html`), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const source = scripts.find(s => s.includes('async function pollGeneration('));
    const ast = parse(source, { ecmaVersion: 'latest' });
    const extract = name => { const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
      assert.ok(node, name); return source.slice(node.start, node.end); };
    const applied = [], checks = [], resumed = [];
    let refreshes = 0;
    const row = { provider: 'Nano Banana 2', kind: 'image', result_url: null, meta: { run_id: 'fixture-run', task_id: null, status: 'processing' } };
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [row] }); } };
    const sandbox = { currentUser: { id: 'fixture-user' }, supabaseClient: { from: () => query },
      document: { visibilityState: 'visible', getElementById: () => null },
      console, setTimeout: cb => cb(), shouldShowResultGeneration: () => true,
      addResultCard: () => ({ apply: value => applied.push(value) }),
      resumeProcessingChecks: pairs => resumed.push(...pairs), isMobileUI: () => false,
      __mjFetchNbCheck: async params => { checks.push(params); return { js: { failed: true, status: 'failed', refunded: true } }; },
      cleanGenerationFailureReason: () => '', extractGenerationFailureReason: () => '',
      showGenerationFailedStatus: () => {}, refreshCredits: async () => { refreshes++; } };
    vm.createContext(sandbox);
    vm.runInContext(extract('loadRecentHistory') + '\n' + extract('pollGeneration'), sandbox);
    await sandbox.loadRecentHistory();
    assert.equal(resumed.length, 1, page);
    assert.equal(resumed[0].taskId, '', page);
    await sandbox.pollGeneration('fixture-run', [resumed[0].controller], {}, null, 'kie-check');
    assert.equal(checks.length, 1, page);
    assert.equal(applied[0].status, 'failed', page);
    assert.equal(refreshes, 1, page);
  }
});
