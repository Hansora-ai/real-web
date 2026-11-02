// Builds the app's pages from the website's own files (../public), unchanged, into app/www.
// Then adds only what the app stores require, through additions/app-shim.js and additions/app.css.
// The live website is never modified. Run: npm run package
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const site = join(here, '../../public');
const out = join(here, '../www');
const edge = join(here, '../../netlify/edge-functions/inject-bottom-nav-inline.js');

// Not part of the app: search-engine verification and the Unlimited/ChatGPT setup pages.
const SKIP = new Set(['google556abf761fa0ce63.html']);

rmSync(out, { recursive: true, force: true });
cpSync(site, out, { recursive: true, filter: src => !SKIP.has(relative(site, src)) });
cpSync(join(here, '../additions'), join(out, 'app'), { recursive: true });

// The website's phone bottom menu is added by a Netlify edge function; run that same code here.
const tmp = join(here, '.edge.mjs');
writeFileSync(tmp, readFileSync(edge, 'utf8'));
const injectBottomNav = (await import(pathToFileURL(tmp).href + `?t=${Date.now()}`)).default;
rmSync(tmp);

const HEAD = '<script src="/app/app-shim.js"></script><link rel="stylesheet" href="/app/app.css">';
let pages = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { if (name !== 'app') walk(file); continue; }
    if (!name.endsWith('.html')) continue;
    pages++;
    const path = '/' + relative(out, file).replace(/\\/g, '/');
    const html = readFileSync(file, 'utf8');
    const response = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    queue.push(injectBottomNav(new Request('https://hansora.co' + path), { next: async () => response })
      .then(r => r.text())
      .then(text => {
        // The app's additions load first, before any of the page's own scripts.
        const withShim = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, m => m + HEAD) : HEAD + text;
        writeFileSync(file, withShim);
      }));
  }
}
const queue = [];
walk(out);
await Promise.all(queue);
console.log(`app/www: ${pages} pages packaged from public/`);
if (!existsSync(join(out, 'index.html'))) throw new Error('index.html missing');
