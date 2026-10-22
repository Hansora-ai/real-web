import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';
import { buildFunctions } from '../../scripts/build-netlify-functions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Netlify bundles all endpoints on API v2 with routes, background jobs and schedules preserved', async () => {
  const generated = await buildFunctions();
  const sources = (await readdir(join(root, 'netlify/functions'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name));
  assert.equal(generated.length, sources.length);
  const dir = await mkdtemp(join(tmpdir(), 'hansora-runtime-test-'));
  try {
    const functions = await zipFunctions(join(root, 'netlify/runtime-functions'), dir, {
      basePath: root, repositoryRoot: root, parallelLimit: 4,
      config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22.x' },
        'run-kling-40': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-henshin': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-seedance-2': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-seedance-25': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-wan-3': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-seedance-cheap': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'run-seedance-25-cheap': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'henshin-templates': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
        'henshin-finish-background': { includedFiles: ['public/vendor/henshin/ffmpeg-core.wasm'] },
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
    assert.ok(get('run-nano-banana-2-1'));
    assert.ok(get('run-seedream-5-flash'));
    assert.equal(get('automation-instagram-comment-process-background').invocationMode, 'background');
    assert.equal(get('automation-instagram-process-background').invocationMode, 'background');
    assert.equal(get('audio-eleven-background').invocationMode, 'background');
    assert.equal(get('henshin-finish-background').invocationMode, 'background');
    assert.equal(get('henshin-sweep').schedule, '* * * * *');
    assert.equal(get('reapi-sweep').schedule, '* * * * *');
    assert.ok(get('reapi-check'));
    assert.ok(get('kling4-check'));assert.equal(get('kling4-sweep').schedule,'* * * * *');
    for (const name of ['run-kling-40','run-henshin','run-seedance-2','run-seedance-25','run-seedance-cheap','run-seedance-25-cheap','run-wan-3']) {
      assert.ok((await readFile(get(name).path)).includes(Buffer.from('public/vendor/henshin/ffmpeg-core.wasm')), `${name} must include the duration-probing WASM`);
    }
    assert.equal(get('kie-missing-task-sweep').schedule, '* * * * *');
    assert.equal(get('dispatch-unlimited-queue').schedule, '* * * * *');
    assert.equal(get('automation-flow-jobs').schedule, '* * * * *');
    assert.ok(JSON.stringify(get('hansora-mcp').routes).includes('/mcp'));
    assert.match(await readFile(join(root, 'netlify/runtime-functions/hansora-mcp.mjs'), 'utf8'), /path: '\/mcp'/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
