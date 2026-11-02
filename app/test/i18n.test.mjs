import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = lang => JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'));
const en = load('en');
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

for (const lang of ['ru', 'hy']) {
  const other = load(lang);
  test(`${lang} has exactly the English keys`, () => {
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort());
  });
  test(`${lang} keeps every {placeholder} and has no empty text`, () => {
    for (const key of Object.keys(en)) {
      assert.ok(other[key]?.trim(), `${lang}.${key} is empty`);
      assert.deepEqual(placeholders(other[key]), placeholders(en[key]), `${lang}.${key} placeholders differ`);
    }
  });
}

// Step 4 adds Apple/Google in-app purchases; until then the app must not talk about buying at all.
test('English never mentions buying (App Store rules)', () => {
  const text = Object.values(en).join(' ').toLowerCase();
  for (const word of ['buy', 'purchase', 'pricing', 'top up', 'top-up']) assert.ok(!text.includes(word), `found "${word}"`);
});
