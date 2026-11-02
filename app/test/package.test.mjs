import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

execFileSync(process.execPath, [new URL('../scripts/package-site.mjs', import.meta.url).pathname]);
const www = new URL('../www/', import.meta.url);
const pages = readdirSync(www).filter(name => name.endsWith('.html'));

test('every page loads the app additions before its own scripts', () => {
  for (const name of pages) {
    const html = readFileSync(new URL(name, www), 'utf8');
    const shim = html.indexOf('/app/app-shim.js');
    assert.ok(shim >= 0, `${name} has no app-shim`);
    const firstScript = html.search(/<script(?![^>]*app-shim)/i);
    assert.ok(firstScript === -1 || shim < firstScript, `${name}: app-shim must come first`);
  }
});

test('Creative pages get the website bottom menu, Automation pages do not (same as the website)', () => {
  assert.match(readFileSync(new URL('index.html', www), 'utf8'), /class="hs-bottom-nav"/);
  assert.doesNotMatch(readFileSync(new URL('automation-inbox.html', www), 'utf8'), /class="hs-bottom-nav"/);
});

test('the website files themselves are not changed', () => {
  const original = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(original, /app-shim/);
});
