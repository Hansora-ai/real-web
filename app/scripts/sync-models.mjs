// Copies the website's model list (const MODELS in public/search-models.html) into the app,
// so models, prices and options always match the website. Runs before every app build.
// Usage: node scripts/sync-models.mjs [--check]   (--check fails if the app's copy is out of date)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = new URL('../../public/search-models.html', import.meta.url);
const target = new URL('../src/data/models.json', import.meta.url);

export function extractModels(html) {
  const start = html.indexOf('const MODELS = [');
  if (start < 0) throw new Error('const MODELS not found in search-models.html');
  let i = html.indexOf('[', start), depth = 0, quote = null;
  for (; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  const literal = html.slice(html.indexOf('[', start), i + 1);
  // The list is plain data (strings, numbers, arrays); evaluate it in an empty sandbox.
  const models = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
  if (!Array.isArray(models) || !models.length) throw new Error('MODELS is empty');
  return JSON.parse(JSON.stringify(models));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = JSON.stringify(extractModels(readFileSync(source, 'utf8')), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== json) { console.error('app/src/data/models.json is out of date: run npm run sync:models'); process.exit(1); }
    console.log('models.json matches the website');
  } else {
    writeFileSync(target, json);
    console.log(`models.json: ${JSON.parse(json).length} models`);
  }
}
