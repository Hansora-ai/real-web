// The card ChatGPT shows under an answer from the Hansora Automation app (OpenAI Apps SDK / MCP Apps UI).
// One small page draws every card; a tool result carries `card: { type, ... }` and the page picks the matching view:
// overview (animated chat numbers), automation (the comment flow drawn step by step), product, employee and call.
// Counts and the owner's own settings only: no customer names or messages ever reach the card.
export const CARD_URI = 'ui://hansora/automation-card-v1.html';
export const CARD_MIME = 'text/html;profile=mcp-app';

export const CARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hansora Automation</title>
<style>
:root{color-scheme:dark;--bg:#141418;--card:#1b1b21;--soft:#24242c;--soft2:#2d2d37;--line:rgba(255,255,255,.08);--text:#f4f4f7;--muted:#a0a0ad;--ai:#7c7cff;--ai2:#a78bfa;--person:#38bdf8;--you:#fb7185;--green:#34d399;--amber:#fbbf24}
:root[data-theme="light"]{color-scheme:light;--bg:#fff;--card:#fff;--soft:#f4f4f7;--soft2:#ebebf0;--line:rgba(0,0,0,.08);--text:#18181d;--muted:#6b6b78;--ai:#5b5bf0;--ai2:#8b5cf6;--person:#0ea5e9;--you:#e11d48;--green:#059669;--amber:#d97706}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:14px/1.45 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:22px;background:var(--card)}
.glow{position:absolute;inset:-40% -20% auto auto;width:320px;height:320px;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--ai) 28%,transparent),transparent);filter:blur(10px);pointer-events:none;animation:drift 9s ease-in-out infinite alternate}
.head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 6px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}.logo{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,var(--ai),var(--ai2));color:#fff;font-weight:800;font-size:14px;box-shadow:0 6px 18px color-mix(in srgb,var(--ai) 40%,transparent)}
.brand b{display:block;font-size:13px}.brand span{display:block;color:var(--muted);font-size:12px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:12px;font-weight:600;white-space:nowrap}
.badge i{width:7px;height:7px;border-radius:50%;background:currentColor}.badge.on{background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green)}.badge.alert{background:color-mix(in srgb,var(--you) 16%,transparent);color:var(--you)}.badge.on i,.badge.alert i{animation:pulse 1.6s ease-in-out infinite}
.body{position:relative;padding:8px 18px 18px}
h2{margin:6px 0 2px;font-size:19px;letter-spacing:-.01em}.sub{margin:0;color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:150px 1fr;gap:18px;align-items:center;margin-top:14px}
.ring{position:relative;width:150px;height:150px}.ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:14;stroke-linecap:round;transition:stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1),stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)}
.ring .track{stroke:var(--soft2)}.ring-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.ring-center b{display:block;font-size:34px;line-height:1;letter-spacing:-.02em}.ring-center span{color:var(--muted);font-size:12px}
.stats{display:grid;gap:8px}
.stat{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--soft);opacity:0;transform:translateY(8px);animation:rise .55s cubic-bezier(.2,.8,.2,1) forwards}
.dot{width:10px;height:10px;border-radius:50%;flex:none}.stat .label{flex:1;color:var(--muted);font-size:13px}.stat b{font-size:18px}
.stat.alert{background:color-mix(in srgb,var(--you) 13%,var(--soft))}.stat.alert b{color:var(--you)}
.section{margin-top:16px}.section-title{margin:0 0 8px;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.bars{display:grid;gap:7px}.bar{display:grid;grid-template-columns:120px 1fr 34px;gap:10px;align-items:center;font-size:13px}
.bar-track{height:8px;border-radius:999px;background:var(--soft2);overflow:hidden}.bar-fill{height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,var(--ai),var(--ai2));transition:width 1.1s cubic-bezier(.2,.8,.2,1)}
.bar span:last-child{text-align:right;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tile{padding:10px;border-radius:14px;background:var(--soft);text-align:center;opacity:0;animation:rise .5s cubic-bezier(.2,.8,.2,1) forwards}
.tile b{display:block;font-size:20px}.tile span{color:var(--muted);font-size:12px}
.foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.foot .muted{color:var(--muted);font-size:13px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--ai),var(--ai2));color:#fff;font:600 13px/1 inherit;cursor:pointer;box-shadow:0 6px 18px color-mix(in srgb,var(--ai) 35%,transparent)}
.btn.ghost{background:var(--soft);color:var(--text);box-shadow:none}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chip{padding:5px 10px;border-radius:999px;background:var(--soft);font-size:12px;font-weight:600;opacity:0;animation:pop .45s cubic-bezier(.3,1.4,.5,1) forwards}
.chip.word{background:color-mix(in srgb,var(--ai) 18%,transparent);color:var(--text)}
.flow{position:relative;margin-top:16px;padding-left:28px}
.flow::before{content:"";position:absolute;left:11px;top:8px;bottom:8px;width:2px;border-radius:2px;background:linear-gradient(var(--ai),var(--ai2));transform-origin:top;transform:scaleY(0);animation:grow var(--flow-time,1.6s) ease-out forwards}
.step{position:relative;margin-bottom:10px;padding:11px 13px;border-radius:14px;background:var(--soft);opacity:0;transform:translateX(-6px);animation:slide .5s cubic-bezier(.2,.8,.2,1) forwards}
.step::before{content:attr(data-icon);position:absolute;left:-28px;top:9px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--card);border:2px solid var(--ai);font-size:12px}
.step b{display:block;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}.step p{margin:3px 0 0;font-size:14px}
.step .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.step .btns span{padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:12px;font-weight:600}
.branch{display:grid;grid-template-columns:1fr 1fr;gap:8px}.branch .step{margin-bottom:0}
.branch .no::before{display:none}.yes{box-shadow:inset 3px 0 0 var(--green)}.no{box-shadow:inset 3px 0 0 var(--amber)}
.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.fact{padding:12px;border-radius:14px;background:var(--soft);opacity:0;animation:rise .5s cubic-bezier(.2,.8,.2,1) forwards}.fact span{display:block;color:var(--muted);font-size:12px}.fact b{font-size:18px}
.desc{margin:12px 0 0;color:var(--muted);font-size:13px}
.channels{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.channel{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:var(--soft);font-size:12px;font-weight:600;opacity:0;animation:pop .45s cubic-bezier(.3,1.4,.5,1) forwards}.channel i{width:7px;height:7px;border-radius:50%;background:var(--muted)}.channel.on i{background:var(--green)}
.phone{position:relative;display:grid;place-items:center;width:96px;height:96px;margin:18px auto 8px}
.phone::before,.phone::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--ai);animation:ripple 2s ease-out infinite}.phone::after{animation-delay:1s}
.phone span{display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--ai),var(--ai2));animation:ring 1.2s ease-in-out infinite}.phone svg{width:28px;height:28px;fill:#fff}
.center{text-align:center}.number{font-size:22px;font-weight:700;letter-spacing:.01em}
.empty{padding:30px 0;color:var(--muted);text-align:center}
@keyframes rise{to{opacity:1;transform:none}}@keyframes slide{to{opacity:1;transform:none}}@keyframes pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}
@keyframes grow{to{transform:scaleY(1)}}@keyframes pulse{50%{opacity:.35}}@keyframes drift{to{transform:translate(-40px,30px)}}
@keyframes ripple{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.5);opacity:0}}@keyframes ring{0%,100%{transform:rotate(0)}20%{transform:rotate(-12deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-6deg)}80%{transform:rotate(6deg)}}
@media (max-width:460px){.hero{grid-template-columns:1fr;justify-items:center}.stats{width:100%}.tiles{grid-template-columns:repeat(2,1fr)}.bar{grid-template-columns:96px 1fr 30px}.branch{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
<div class="card" id="card"><div class="glow"></div><div id="root"><div class="empty">Loading…</div></div></div>
<script>
(() => {
  const root = document.getElementById('root');
  let nextId = 1, lastKey = '', initialized = false, lastHeight = 0;
  const pending = new Map();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value) => Number(value) || 0;
  const fmt = (value) => num(value).toLocaleString();

  function applyTheme(theme) { if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';

  function reportSize() {
    const height = Math.ceil(document.getElementById('card').getBoundingClientRect().height);
    if (!initialized || !height || height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height } }, '*');
  }
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, method === 'ui/initialize' ? 4000 : 15000);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  function openLink(url) {
    if (!url) return;
    if (typeof window.openai?.openExternal === 'function') { try { window.openai.openExternal({ href: url }); return; } catch {} }
    request('ui/open-link', { url }).catch(() => window.open(url, '_blank', 'noopener'));
  }

  // Counts up from 0 with an ease-out, so the numbers "arrive".
  function countUp(element, target, delay = 0) {
    const end = num(target), start = performance.now() + delay, time = 1100;
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / time));
      element.textContent = fmt(Math.round(end * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(tick);
    };
    element.textContent = '0';
    requestAnimationFrame(tick);
  }
  function animateNumbers() { root.querySelectorAll('[data-count]').forEach((el, i) => countUp(el, el.dataset.count, num(el.dataset.delay) || i * 80)); }

  function head(title, subtitle, badge) {
    return '<div class="head"><div class="brand"><div class="logo">H</div><div><b>' + esc(title) + '</b><span>' + esc(subtitle) + '</span></div></div>' + (badge || '') + '</div>';
  }

  function overview(c) {
    const chats = c.chats || {}, total = num(chats.total);
    const parts = [['handled_by_ai', 'Handled by AI', 'var(--ai)'], ['answered_by_a_person', 'Answered by your team', 'var(--person)'], ['need_you', 'Need you now', 'var(--you)']];
    const r = 60, length = 2 * Math.PI * r;
    const circles = parts.map(([key, , color]) => '<circle data-part="' + key + '" r="' + r + '" cx="75" cy="75" stroke="' + color + '" stroke-dasharray="0 ' + length + '"></circle>').join('');
    const stats = parts.map(([key, label, color], i) => '<div class="stat' + (key === 'need_you' && num(chats[key]) ? ' alert' : '') + '" style="animation-delay:' + (200 + i * 120) + 'ms"><span class="dot" style="background:' + color + '"></span><span class="label">' + label + '</span><b data-count="' + num(chats[key]) + '" data-delay="' + (300 + i * 120) + '">0</b></div>').join('');
    const channels = (chats.by_channel || []).slice(0, 6), top = Math.max(1, ...channels.map((item) => num(item.chats)));
    const bars = channels.map((item) => '<div class="bar"><span>' + esc(item.channel) + '</span><div class="bar-track"><div class="bar-fill" data-width="' + Math.round(num(item.chats) / top * 100) + '"></div></div><span>' + fmt(item.chats) + '</span></div>').join('');
    const today = c.today || {};
    const tiles = [['orders', 'Orders'], ['bookings', 'Bookings'], ['leads', 'Leads'], ['calls', 'Calls']].map(([key, label], i) => '<div class="tile" style="animation-delay:' + (500 + i * 90) + 'ms"><b data-count="' + num(today[key]) + '" data-delay="' + (600 + i * 90) + '">0</b><span>' + label + '</span></div>').join('');
    root.innerHTML = head('Hansora Automation', c.period || 'Last 7 days', c.need_you_now ? '<span class="badge alert"><i></i>' + fmt(c.need_you_now) + ' need you</span>' : '<span class="badge on"><i></i>All handled</span>')
      + '<div class="body"><h2>' + (total ? fmt(total) + ' conversations' : 'No conversations yet') + '</h2><p class="sub">' + esc(c.subtitle || '') + '</p>'
      + '<div class="hero"><div class="ring"><svg viewBox="0 0 150 150"><circle class="track" r="' + r + '" cx="75" cy="75"></circle>' + circles + '</svg><div class="ring-center"><div><b data-count="' + total + '">0</b><span>chats</span></div></div></div><div class="stats">' + stats + '</div></div>'
      + (bars ? '<div class="section"><p class="section-title">By channel</p><div class="bars">' + bars + '</div></div>' : '')
      + '<div class="section"><p class="section-title">Last 24 hours</p><div class="tiles">' + tiles + '</div></div>'
      + '<div class="foot"><span class="muted">' + (c.credits != null ? fmt(c.credits) + '⚡ credits' : '') + '</span>' + (c.inbox_url ? '<button class="btn" data-link="' + esc(c.inbox_url) + '">Open inbox</button>' : '') + '</div></div>';
    // Draw the ring segments one after another.
    requestAnimationFrame(() => setTimeout(() => {
      let offset = 0;
      parts.forEach(([key]) => {
        const share = total ? num(chats[key]) / total : 0, size = share * length;
        const circle = root.querySelector('[data-part="' + key + '"]');
        if (circle) { circle.style.strokeDasharray = Math.max(0, size - (size > 8 ? 4 : 0)) + ' ' + length; circle.style.strokeDashoffset = -offset; }
        offset += size;
      });
      root.querySelectorAll('.bar-fill').forEach((bar, i) => setTimeout(() => { bar.style.width = bar.dataset.width + '%'; }, i * 90));
    }, 120));
  }

  const ICONS = { comment: '💬', reply: '↩', dm: '✉', check: '?', follow: '➕', link: '🔗' };
  function automation(c) {
    const words = (c.keywords || []).map((w, i) => '<span class="chip word" style="animation-delay:' + (150 + i * 70) + 'ms">' + esc(w) + '</span>').join('');
    let delay = 300;
    const stepHtml = (s, extra = '') => { const html = '<div class="step ' + extra + '" data-icon="' + (ICONS[s.kind] || '•') + '" style="animation-delay:' + delay + 'ms"><b>' + esc(s.title) + '</b>' + (s.text ? '<p>' + esc(s.text) + '</p>' : '') + ((s.buttons || []).length ? '<div class="btns">' + s.buttons.map((b) => '<span>' + esc(b) + '</span>').join('') + '</div>' : '') + '</div>'; delay += 260; return html; };
    const steps = (c.steps || []).map((s) => s.branch ? '<div class="branch">' + stepHtml(s.yes, 'yes') + stepHtml(s.no, 'no') + '</div>' : stepHtml(s)).join('');
    root.innerHTML = head(c.platform === 'tiktok' ? 'TikTok comment automation' : 'Instagram comment automation', c.posts || '', c.on ? '<span class="badge on"><i></i>On</span>' : '<span class="badge"><i></i>Off</span>')
      + '<div class="body"><h2>' + esc(c.name) + '</h2><div class="chips">' + words + '</div>'
      + '<div class="flow" style="--flow-time:' + Math.max(900, delay) + 'ms">' + steps + '</div>'
      + '<div class="foot"><span class="muted">' + (c.on ? 'Live: it answers matching comments now.' : 'Saved switched off. Ask to turn it on when ready.') + '</span>' + (c.edit_url ? '<button class="btn ghost" data-link="' + esc(c.edit_url) + '">Open in builder</button>' : '') + '</div></div>';
  }

  function product(c) {
    const price = c.price == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: c.currency || 'USD' }).format(num(c.price));
    const facts = [['Price', price], ['In stock', c.stock == null ? 'Not tracked' : fmt(c.stock)], ['Photos', fmt(c.photos)]].map(([k, v], i) => '<div class="fact" style="animation-delay:' + (150 + i * 100) + 'ms"><span>' + k + '</span><b>' + esc(v) + '</b></div>').join('');
    root.innerHTML = head(c.added ? 'Product added' : 'Product updated', c.employee || '', c.shown ? '<span class="badge on"><i></i>Shown to customers</span>' : '<span class="badge"><i></i>Hidden</span>')
      + '<div class="body"><h2>' + esc(c.name) + '</h2>' + (c.category ? '<p class="sub">' + esc(c.category) + '</p>' : '') + '<div class="facts">' + facts + '</div>' + (c.description ? '<p class="desc">' + esc(c.description) + '</p>' : '')
      + '<div class="foot"><span class="muted">' + (c.ai_offers_products ? 'Your AI employee can offer it in chats.' : 'Your AI employee does not offer products yet.') + '</span>' + (c.products_url ? '<button class="btn ghost" data-link="' + esc(c.products_url) + '">Open products</button>' : '') + '</div></div>';
  }

  function employee(c) {
    const channels = (c.channels || []).map((ch, i) => '<span class="channel' + (ch.on ? ' on' : '') + '" style="animation-delay:' + (200 + i * 70) + 'ms"><i></i>' + esc(ch.name) + '</span>').join('');
    root.innerHTML = head(c.created ? 'AI employee created' : 'AI employee', c.business || '', c.live ? '<span class="badge on"><i></i>Live</span>' : '<span class="badge"><i></i>No channel yet</span>')
      + '<div class="body"><h2>' + esc(c.name) + '</h2><p class="sub">' + esc(c.category || '') + '</p><div class="channels">' + channels + '</div>'
      + '<div class="foot"><span class="muted">' + (c.live ? 'It answers customers on the green channels.' : 'Connect a channel so it starts answering.') + '</span>' + (c.connect_url ? '<button class="btn" data-link="' + esc(c.connect_url) + '">Connect a channel</button>' : '') + '</div></div>';
  }

  function call(c) {
    root.innerHTML = head('AI phone call', 'From ' + (c.from || 'your Hansora number'), '<span class="badge on"><i></i>Calling</span>')
      + '<div class="body center"><div class="phone"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg></span></div><div class="number">' + esc(c.calling) + '</div>' + (c.person ? '<p class="sub">' + esc(c.person) + '</p>' : '')
      + (c.purpose ? '<div class="step" data-icon="✦" style="text-align:left;margin:16px 0 0 28px;animation-delay:200ms"><b>What the AI will do</b><p>' + esc(c.purpose) + '</p></div>' : '')
      + '<div class="foot"><span class="muted">The summary appears a minute or two after the call ends.</span>' + (c.phone_url ? '<button class="btn ghost" data-link="' + esc(c.phone_url) + '">Phone page</button>' : '') + '</div></div>';
  }

  const VIEWS = { overview, automation, product, employee, call };
  function resultData(result, depth = 0) {
    if (!result || depth > 5) return null;
    if (typeof result === 'string') { try { return resultData(JSON.parse(result), depth + 1); } catch { return null; } }
    if (typeof result !== 'object') return null;
    if (result.card) return result;
    const nested = result.structuredContent || result.mcp_tool_result || result.call_tool_result;
    if (nested) return resultData(nested, depth + 1);
    if (Array.isArray(result.content)) for (const item of result.content) { const value = item?.type === 'text' ? resultData(item.text, depth + 1) : null; if (value) return value; }
    return null;
  }
  function render(result) {
    const data = resultData(result);
    const card = data?.card;
    if (!card || !VIEWS[card.type]) return;
    const key = JSON.stringify(card);
    if (key === lastKey) return;
    lastKey = key;
    VIEWS[card.type](card);
    root.querySelectorAll('[data-link]').forEach((button) => button.addEventListener('click', () => openLink(button.dataset.link)));
    animateNumbers();
    setTimeout(reportSize, 30); setTimeout(reportSize, 1800);
  }
  function syncGlobals(globals = window.openai || {}) {
    applyTheme(globals.theme);
    if (globals.toolOutput) render(globals.toolOutput);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id !== undefined && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(message.error) : item.resolve(message.result); return; }
    if (message.method === 'ui/notifications/tool-result') render(message.params);
    if (message.method === 'ui/notifications/host-context-changed') applyTheme(message.params?.theme);
  }, { passive: true });
  window.addEventListener('openai:set_globals', (event) => syncGlobals(event.detail?.globals), { passive: true });

  (async () => {
    syncGlobals();
    try {
      const init = await request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'Hansora Automation', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline'] } });
      applyTheme(init?.hostContext?.theme);
    } catch {}
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
    initialized = true;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportSize).observe(document.getElementById('card'));
    reportSize();
  })();
})();
</script>
</body>
</html>`;

export function cardResource() {
  return {
    contents: [{
      uri: CARD_URI,
      mimeType: CARD_MIME,
      text: CARD_HTML,
      _meta: {
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/widgetPrefersBorder': false,
        'openai/widgetDescription': 'A card with the result: animated chat numbers, a comment automation drawn step by step, a product, an AI employee or a phone call.',
        'openai/widgetCSP': { connect_domains: [], resource_domains: [] }
      }
    }]
  };
}

export const CARD_TOOL_META = (invoking, invoked) => ({
  ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] },
  'openai/outputTemplate': CARD_URI,
  'openai/toolInvocation/invoking': invoking,
  'openai/toolInvocation/invoked': invoked
});

// ---------- What each tool puts in `card` ----------

const STEP_TITLES = { comment: 'Someone comments', reply: 'Public reply', dm: 'Private message', check: 'Follower check', follow: 'If they do not follow', link: 'If they follow' };
export function automationCard(row, view, editUrl) {
  const steps = Array.isArray(row.dm_steps) ? row.dm_steps : [];
  const byId = Object.fromEntries(steps.map(step => [step.id, step]));
  const buttons = step => (step?.actions || []).map(action => action.label).filter(Boolean);
  const flow = [{ kind: 'comment', title: STEP_TITLES.comment, text: view.reacts_to }];
  if (view.public_replies?.length) flow.push({ kind: 'reply', title: STEP_TITLES.reply, text: view.public_replies.join('  ·  ') });
  const opening = steps.find(step => step.commentReply || step.entry) || steps.find(step => step.type === 'message');
  if (opening) flow.push({ kind: 'dm', title: STEP_TITLES.dm, text: opening.text, buttons: buttons(opening) });
  const check = steps.find(step => step.type === 'condition' && (step.rules || []).some(rule => rule.field === 'follows'));
  if (check) {
    const yes = byId[check.yesId], no = byId[check.noId];
    flow.push({ kind: 'check', title: STEP_TITLES.check, text: 'Do they follow your account?' });
    flow.push({ branch: true, yes: { kind: 'link', title: STEP_TITLES.link, text: yes?.text || '', buttons: buttons(yes) }, no: { kind: 'follow', title: STEP_TITLES.follow, text: no?.text || '', buttons: buttons(no) } });
  } else if (steps.length > 1) {
    flow.push({ kind: 'dm', title: `${steps.length - 1} more step${steps.length > 2 ? 's' : ''}`, text: 'Open the builder to see the whole flow.' });
  }
  return { type: 'automation', name: view.name, platform: view.platform === 'TikTok' ? 'tiktok' : 'instagram', on: view.status === 'on', reacts_to: view.reacts_to, keywords: row.match_type === 'any' ? [] : (row.keywords || []), posts: view.posts, steps: flow, edit_url: editUrl };
}
