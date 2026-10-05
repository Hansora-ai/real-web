import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';
import { buildFunctions } from '../../scripts/build-netlify-functions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Netlify bundles all 158 endpoints on API v2 with routes, background jobs and schedules preserved', async () => {
  const generated = await buildFunctions();
  assert.equal(generated.length, 158);
  const dir = await mkdtemp(join(tmpdir(), 'hansora-runtime-test-'));
  try {
    const functions = await zipFunctions(join(root, 'netlify/runtime-functions'), dir, {
      basePath: root, repositoryRoot: root, parallelLimit: 4,
      config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22.x' },
        'dispatch-unlimited-queue': { schedule: '* * * * *' },
        'automation-flow-jobs': { schedule: '* * * * *' },
        'automation-media-cleanup': { schedule: '20 3 * * *' },
        'automation-catalog-sync': { schedule: '7 * * * *' },
        'automation-knowledge-refresh': { schedule: '40 4 * * *' }
      }
    });
    assert.equal(functions.length, generated.length);
    for (const fn of functions) assert.equal(fn.runtimeAPIVersion, 2, `${fn.name} must use the modern runtime`);
    const get = name => functions.find(fn => fn.name === name);
    assert.equal(get('automation-instagram-comment-process-background').invocationMode, 'background');
    assert.equal(get('automation-instagram-process-background').invocationMode, 'background');
    assert.equal(get('audio-eleven-background').invocationMode, 'background');
    assert.equal(get('dispatch-unlimited-queue').schedule, '* * * * *');
    assert.equal(get('automation-flow-jobs').schedule, '* * * * *');
    assert.ok(JSON.stringify(get('hansora-mcp').routes).includes('/mcp'));
    assert.match(await readFile(join(root, 'netlify/runtime-functions/hansora-mcp.mjs'), 'utf8'), /path: '\/mcp'/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
