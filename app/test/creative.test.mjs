import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const models = JSON.parse(readFileSync(new URL('../src/data/models.json', import.meta.url), 'utf8'));
const ready = readFileSync(new URL('../src/creative/models.ts', import.meta.url), 'utf8').match(/const READY = new Set\(\[([\s\S]*?)\]\)/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
const requests = readFileSync(new URL('../src/creative/requests.ts', import.meta.url), 'utf8');

test('every model the app offers exists on the website', () => {
  for (const id of ready) assert.ok(models.some(m => m.id === id), `${id} is not in the website's MODELS`);
});

test('every offered model has a request format (or the GPT-Image rule)', () => {
  for (const id of ready) assert.ok(requests.includes(`'${id}'`) || id.startsWith('gpt-image'), `${id} has no case in requests.ts`);
});

test('every offered model goes to a real server function', () => {
  for (const id of ready) {
    const m = models.find(x => x.id === id);
    assert.match(m.endpoint, /^\/\.netlify\/functions\/[a-z0-9-]+$/);
  }
});
