// Netlify PR previews only (netlify.toml [context.deploy-preview]): adds the app additions to the
// deploy-preview copy of the website, so the preview link shows the app version. Production is never touched.
import { cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CONTEXT !== 'deploy-preview') { console.log('preview-site: not a deploy preview, nothing done'); process.exit(0); }
const here = fileURLToPath(new URL('.', import.meta.url));
const site = join(here, '../../public');
cpSync(join(here, '../additions'), join(site, 'app'), { recursive: true });
const HEAD = '<script src="/app/app-shim.js"></script><link rel="stylesheet" href="/app/app.css">';
let pages = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { walk(file); continue; }
    if (!name.endsWith('.html')) continue;
    const html = readFileSync(file, 'utf8');
    if (html.includes('/app/app-shim.js')) continue;
    writeFileSync(file, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + HEAD) : HEAD + html);
    pages++;
  }
})(site);
console.log(`preview-site: app additions added to ${pages} preview pages`);
