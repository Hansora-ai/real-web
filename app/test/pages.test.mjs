import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static checks over every page of the app (no browser needed). The full in-browser check
// (every visible button and link) is test/audit.cjs: run `npm run audit`.
const web = fileURLToPath(new URL('../web/', import.meta.url));
const pages = readdirSync(web).filter(n => n.endsWith('.html'));
const exists = href => {
  const p = href.split(/[?#]/)[0];
  if (!p || p === '/') return true;
  const f = join(web, p.replace(/^\//, ''));
  return (existsSync(f) && statSync(f).isFile()) || existsSync(f + '.html');
};

test('no page loads the login library from the internet (the app carries its own copy)', () => {
  for (const name of pages) assert.doesNotMatch(readFileSync(join(web, name), 'utf8'), /cdn\.jsdelivr\.net\/npm\/@supabase/, name);
  assert.ok(existsSync(join(web, 'app/vendor/supabase-js-2.118.0.js')));
});

test('every link written in a page goes to a page that exists in the app', () => {
  const broken = [];
  for (const name of pages) {
    const html = readFileSync(join(web, name), 'utf8');
    for (const [, href] of html.matchAll(/href="([^"$`{}]+)"/g)) {
      if (/^(https?:|\/\/|mailto:|tel:|#|javascript:|data:)/i.test(href) || /\.(css|png|svg|ico|webp|jpg|json|xml|txt)(\?|$)/i.test(href)) continue;
      if (!exists(href.startsWith('/') ? href : '/' + href)) broken.push(`${name} -> ${href}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the app login screen exists and every login goes there', () => {
  assert.ok(existsSync(join(web, 'app/login.html')));
  assert.match(readFileSync(join(web, 'header.js'), 'utf8'), /location\.href = `\/app\/login\.html\?\$\{target\}`/);
});
