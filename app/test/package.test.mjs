import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The app's own files (web/) — a separate copy of the website, changed for the app.
const web = new URL('../web/', import.meta.url);
const pages = readdirSync(web).filter(name => name.endsWith('.html'));

test('every app page loads the app parts before its own scripts', () => {
  for (const name of pages) {
    const html = readFileSync(new URL(name, web), 'utf8');
    const shim = html.indexOf('/app/app-shim.js');
    assert.ok(shim >= 0, `${name} has no app-shim`);
    const firstScript = html.search(/<script(?![^>]*app-shim)/i);
    assert.ok(firstScript === -1 || shim < firstScript, `${name}: app-shim must come first`);
  }
});

test('Creative pages have the bottom bar, Automation pages their own (same as the website)', () => {
  assert.match(readFileSync(new URL('index.html', web), 'utf8'), /class="hs-bottom-nav"/);
  assert.doesNotMatch(readFileSync(new URL('automation-inbox.html', web), 'utf8'), /class="hs-bottom-nav"/);
});

test('the app does not open the website: no page points the app at hansora.co', () => {
  const config = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /server\s*:\s*\{[^}]*url/);
  assert.match(config, /webDir: 'web'/);
});
