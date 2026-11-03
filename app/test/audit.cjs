// Full audit of the app copy: every page, every link/button, store-rule words, broken targets, page errors.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = require('path').join(__dirname, '../web');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); }).listen(5190);
const exists = href => { const p = href.split(/[?#]/)[0]; if (p === '/' || p === '') return true; let f = path.join(root, p); if (fs.existsSync(f) && fs.statSync(f).isFile()) return true; if (fs.existsSync(f + '.html')) return true; return false; };
const WORDS = /\b(pricing|buy|purchase|top.?up|subscribe|upgrade|checkout|payment|pay now|telegram|course|discount|% off|chatgpt|plugin|affiliate)\b/i;
(async () => {
  const pages = fs.readdirSync(root).filter(n => n.endsWith('.html')).concat(['app/login.html']);
  const b = await chromium.launch();
  const report = {};
  for (const name of pages) {
    const ctx = await b.newContext({ ...devices['iPhone 15 Pro Max'] });
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message.slice(0, 120)));
    p.on('dialog', d => d.dismiss());
    try { await p.goto('http://localhost:5190/' + name, { waitUntil: 'domcontentloaded', timeout: 15000 }); await p.waitForTimeout(2500); } catch (e) { errors.push('load: ' + e.message.slice(0, 80)); }
    const finalUrl = p.url().replace('http://localhost:5190', '');
    const items = await p.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      return [...document.querySelectorAll('a[href], button, [onclick]')].filter(vis).map(el => ({ tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60), href: el.getAttribute('href') || '', target: el.getAttribute('target') || '' }));
    }).catch(() => []);
    const text = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const issues = [];
    for (const it of items) {
      const h = it.href;
      if (h && /^https?:\/\//i.test(h) && !/hansora\.co/i.test(h)) issues.push(`external link: "${it.text}" -> ${h}`);
      else if (h && /^https?:\/\/(www\.)?hansora\.co/i.test(h)) issues.push(`link to website: "${it.text}" -> ${h}`);
      else if (h && h.startsWith('/') && !exists(h)) issues.push(`missing page: "${it.text}" -> ${h}`);
      else if (h && !h.startsWith('/') && !h.startsWith('#') && !/^(mailto|tel|javascript):/i.test(h) && !exists('/' + h)) issues.push(`missing page: "${it.text}" -> ${h}`);
      if (WORDS.test(it.text) || WORDS.test(h)) issues.push(`store-rule check: ${it.tag} "${it.text}" ${h}`);
    }
    const wordHits = [...new Set((text.match(new RegExp(WORDS.source, 'gi')) || []).map(w => w.toLowerCase()))];
    report[name] = { finalUrl, buttons: items.length, errors: [...new Set(errors)], issues: [...new Set(issues)], words: wordHits };
    await ctx.close();
  }
  await b.close(); server.close();
  fs.writeFileSync(require('path').join(__dirname, '../audit-report.json'), JSON.stringify(report, null, 1));
  let total = 0; for (const [n, r] of Object.entries(report)) { total += r.buttons; }
  console.log('pages:', pages.length, 'visible links/buttons checked:', total);
})();
