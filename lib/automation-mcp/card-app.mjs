// The card ChatGPT shows under an answer from the Hansora Automation app (OpenAI Apps SDK / MCP Apps UI).
// One small page draws every card; a tool result carries `card: { type, ... }` and the page picks the matching view:
// overview (animated chat numbers), automation (the comment flow drawn step by step), product, employee and call.
// Counts and the owner's own settings only: no customer names or messages ever reach the card.
export const CARD_URI = 'ui://hansora/automation-card-v4.html';
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
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--ai),var(--ai2));color:#fff;font-family:inherit;font-size:13px;font-weight:600;line-height:1;cursor:pointer;box-shadow:0 6px 18px color-mix(in srgb,var(--ai) 35%,transparent)}
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
.pills{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px}
.pill{position:relative;padding:11px 8px;border-radius:14px;background:var(--soft);text-align:center;opacity:0;animation:pop .45s cubic-bezier(.3,1.4,.5,1) forwards}
.pill i{display:block;width:10px;height:10px;margin:0 auto 6px;border-radius:50%;background:var(--soft2)}.pill.on i{background:var(--green);box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 18%,transparent);animation:pulse 2s ease-in-out infinite}
.pill b{display:block;font-size:12px}.pill span{color:var(--muted);font-size:11px}
.panel{margin-top:14px;padding:14px;border-radius:16px;background:color-mix(in srgb,var(--soft) 55%,transparent);border:1px solid var(--line);opacity:0;animation:rise .55s cubic-bezier(.2,.8,.2,1) forwards}
.panel.changed{border-color:color-mix(in srgb,var(--ai) 60%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--ai) 14%,transparent)}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.panel-head b{font-size:14px}.panel-head span{color:var(--muted);font-size:12px}
.week{display:grid;gap:6px}.day{display:grid;grid-template-columns:38px 1fr 110px;gap:10px;align-items:center;font-size:12px}
.day > span:first-child{color:var(--muted);font-weight:600}.day > span:last-child{color:var(--muted);text-align:right;line-height:1.3}
.track{position:relative;height:12px;border-radius:999px;background:var(--soft2);overflow:hidden}
.track i{position:absolute;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,var(--ai),var(--ai2));transform-origin:left;transform:scaleX(0);animation:fill .8s cubic-bezier(.2,.8,.2,1) forwards}
.track.now::after{content:"";position:absolute;top:-2px;bottom:-2px;width:2px;left:var(--now);background:var(--you);border-radius:2px}
.ticks{display:grid;grid-template-columns:38px 1fr 110px;gap:10px;margin-top:2px;color:var(--muted);font-size:10px}.ticks div{display:flex;justify-content:space-between}
.mini{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.mini span{padding:5px 9px;border-radius:999px;background:var(--soft);font-size:12px;opacity:0;animation:pop .4s cubic-bezier(.3,1.4,.5,1) forwards}.mini span em{font-style:normal;color:var(--muted)}
.qs{display:grid;gap:6px;counter-reset:q}.qs span{display:flex;align-items:center;gap:8px;font-size:13px;opacity:0;animation:slide .45s cubic-bezier(.2,.8,.2,1) forwards}
.qs span::before{counter-increment:q;content:counter(q);display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:color-mix(in srgb,var(--ai) 22%,transparent);font-size:11px;font-weight:700}
.checks{display:grid;gap:6px}.checks span{display:flex;align-items:center;gap:8px;font-size:13px;opacity:0;animation:slide .45s cubic-bezier(.2,.8,.2,1) forwards}
.checks span::before{content:"";flex:none;width:16px;height:16px;border-radius:5px;background:var(--soft2)}.checks span.ck-yes::before{background:var(--green) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") center/14px no-repeat}
.checks span.ck-no{color:var(--muted)}
.switches{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px}
.switch{display:inline-flex!important;align-items:center;gap:8px;margin-top:8px!important;color:var(--text)!important;font-size:13px!important;font-weight:500!important;cursor:pointer}
.switch input{position:absolute;opacity:0;pointer-events:none}.switch span{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:var(--soft2);transition:background .2s}
.switch span::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.switch input:checked+span{background:linear-gradient(90deg,var(--ai),var(--ai2))}.switch input:checked+span::after{transform:translateX(14px)}
.switch input:focus-visible+span{outline:2px solid var(--ai);outline-offset:2px}
.day-edit{display:grid;grid-template-columns:90px repeat(4,1fr);gap:6px;align-items:center;margin-top:6px}.day-edit .input{margin-top:0;padding:7px 8px;font-size:13px}.day-edit .switch{margin-top:0!important}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.small{font-size:11px!important}.hint{margin:6px 0 0;color:var(--muted);font-size:12px}
@media (max-width:460px){.day-edit{grid-template-columns:76px 1fr 1fr}.day-edit input:nth-of-type(4),.day-edit input:nth-of-type(5){grid-column:span 1}.grid4{grid-template-columns:1fr 1fr}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.two .panel{margin-top:0}
@keyframes fill{to{transform:scaleX(1)}}
@media (max-width:460px){.pills{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:1fr}.day{grid-template-columns:34px 1fr 84px}.ticks{grid-template-columns:34px 1fr 84px}}

.still .step,.still .chip,.still .flow::before{animation:none!important;opacity:1!important;transform:none!important}
.actions{display:flex;flex-wrap:wrap;gap:8px}.btn:disabled{opacity:.6;cursor:default}
.notice{margin:12px 0 0;padding:9px 12px;border-radius:12px;background:var(--soft);font-size:13px}
.editor label{display:block;margin-top:12px;color:var(--muted);font-size:12px;font-weight:600}.editor small{font-weight:500;opacity:.8}
.input{display:block;width:100%;margin-top:6px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--text);font-family:inherit;font-size:14px;line-height:1.4;resize:vertical}
.input:focus{outline:2px solid color-mix(in srgb,var(--ai) 55%,transparent);border-color:transparent}
.edit-block{margin-top:14px;padding:12px;border-radius:14px;background:color-mix(in srgb,var(--soft) 60%,transparent);border:1px solid var(--line)}.edit-block b{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.row{display:grid;grid-template-columns:1fr 2fr;gap:8px}.row .input{margin-top:8px}
@media (max-width:460px){.row{grid-template-columns:1fr}}
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

  const ICONS = { comment: '💬', reply: '↩', dm: '✉', check: '?', follow: '➕', link: '🔗', more: '⋯' };
  let editing = false, busy = false, current = null, notice = '';
  const label = (b) => (typeof b === 'string' ? b : b?.label) || '';
  function automation(c) {
    current = c;
    if (editing) return automationEditor(c);
    const words = (c.keywords || []).map((w, i) => '<span class="chip word" style="animation-delay:' + (150 + i * 70) + 'ms">' + esc(w) + '</span>').join('');
    let delay = 300;
    const stepHtml = (s, extra = '') => { const html = '<div class="step ' + extra + '" data-icon="' + (ICONS[s.kind] || '•') + '" style="animation-delay:' + delay + 'ms"><b>' + esc(s.title) + '</b>' + (s.text ? '<p>' + esc(s.text) + '</p>' : '') + ((s.buttons || []).length ? '<div class="btns">' + s.buttons.map((b) => '<span>' + esc(label(b)) + '</span>').join('') + '</div>' : '') + '</div>'; delay += 260; return html; };
    const steps = (c.steps || []).map((s) => s.branch ? '<div class="branch">' + stepHtml(s.yes, 'yes') + stepHtml(s.no, 'no') + '</div>' : stepHtml(s)).join('');
    const canAct = Boolean(c.automation_id) && canCall();
    root.innerHTML = head(c.platform === 'tiktok' ? 'TikTok comment automation' : 'Instagram comment automation', c.posts || '', c.on ? '<span class="badge on"><i></i>On</span>' : '<span class="badge"><i></i>Off</span>')
      + '<div class="body"><h2>' + esc(c.name) + '</h2><div class="chips">' + words + '</div>'
      + '<div class="flow" style="--flow-time:' + Math.max(900, delay) + 'ms">' + steps + '</div>'
      + (notice ? '<p class="notice">' + esc(notice) + '</p>' : '')
      + '<div class="foot"><span class="muted">' + (c.on ? 'Live: it answers matching comments now.' : 'Saved switched off.') + '</span><div class="actions">'
      + (canAct ? '<button class="btn ghost" data-act="edit">✎ Edit</button><button class="btn ghost" data-act="ask">Ask ChatGPT to change it</button><button class="btn" data-act="toggle">' + (c.on ? 'Turn off' : 'Turn on') + '</button>' : '')
      + (c.edit_url ? '<button class="btn ghost" data-link="' + esc(c.edit_url) + '">Open in builder</button>' : '') + '</div></div></div>';
  }
  function field(name, value, attrs = '') { return '<input class="input" data-field="' + name + '" value="' + esc(value) + '" ' + attrs + '>'; }
  function area(name, value, attrs = '') { return '<textarea class="input" rows="2" data-field="' + name + '" ' + attrs + '>' + esc(value) + '</textarea>'; }
  function editStep(s) {
    if (!s?.id) return '';
    const buttons = (s.buttons || []).map((b) => '<div class="row">' + field('label:' + s.id + ':' + b.id, b.label, 'maxlength="20" placeholder="Button label"') + (b.url !== undefined ? field('url:' + s.id + ':' + b.id, b.url, 'maxlength="1000" placeholder="https://"') : '') + '</div>').join('');
    return '<div class="edit-block"><b>' + esc(s.title) + '</b>' + area('text:' + s.id, s.text, 'maxlength="640"') + buttons + '</div>';
  }
  function automationEditor(c) {
    const messages = [];
    (c.steps || []).forEach((s) => { if (s.branch) { messages.push(s.yes, s.no); } else if (s.id) messages.push(s); });
    const tiktok = c.platform === 'tiktok';
    root.innerHTML = head('Edit automation', c.posts || '', '<span class="badge"><i></i>Editing</span>')
      + '<div class="body editor"><label>Name' + field('name', c.name, 'maxlength="200"') + '</label>'
      + '<label>Reacts to<select class="input" data-field="match"><option value="contains"' + (c.match === 'contains' ? ' selected' : '') + '>Comments that contain a word</option>' + (tiktok ? '' : '<option value="exact"' + (c.match === 'exact' ? ' selected' : '') + '>Comments that are exactly a word</option>') + '<option value="any"' + (c.match === 'any' ? ' selected' : '') + '>Any comment</option></select></label>'
      + '<label>Words <small>comma between words</small>' + field('keywords', (c.keywords || []).join(', '), 'placeholder="price, how much"') + '</label>'
      + '<label>Public replies <small>one per line, up to 3' + (tiktok ? '' : ', empty for none') + '</small>' + area('replies', (c.public_replies || []).join('\n'), 'rows="3"') + '</label>'
      + messages.map(editStep).join('')
      + (notice ? '<p class="notice">' + esc(notice) + '</p>' : '')
      + '<div class="foot"><span class="muted">Steps, posts and their order are changed in the builder.</span><div class="actions"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn" data-act="save"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save') + '</button></div></div></div>';
  }
  function collectEdits() {
    const value = (name) => root.querySelector('[data-field="' + CSS.escape(name) + '"]')?.value ?? '';
    const steps = {};
    root.querySelectorAll('[data-field]').forEach((el) => {
      const [kind, stepId, buttonId] = el.dataset.field.split(':');
      if (!['text', 'label', 'url'].includes(kind)) return;
      const step = steps[stepId] || (steps[stepId] = { step_id: stepId, buttons: [] });
      if (kind === 'text') step.text = el.value;
      else { let button = step.buttons.find((b) => b.button_id === buttonId); if (!button) step.buttons.push(button = { button_id: buttonId }); button[kind] = el.value; }
    });
    return {
      automation_id: current.automation_id,
      name: value('name'),
      reacts_to: value('match'),
      keywords: value('keywords').split(',').map((w) => w.trim()).filter(Boolean),
      public_replies: value('replies').split('\n').map((w) => w.trim()).filter(Boolean),
      steps: Object.values(steps)
    };
  }
  function canCall() { return typeof window.openai?.callTool === 'function' || initialized; }
  function callTool(name, args) {
    if (typeof window.openai?.callTool === 'function') return Promise.resolve(window.openai.callTool(name, args));
    return request('tools/call', { name, arguments: args });
  }
  async function act(kind) {
    if (busy || !current) return;
    if (kind === 'edit') { editing = true; notice = ''; return redraw(); }
    if (kind === 'cancel') { editing = false; notice = ''; return redraw(); }
    if (kind === 'save-tools') return saveTools();
    if (kind === 'ask') {
      const prompt = 'I want to change my comment automation "' + current.name + '". Ask me what to change.';
      try { if (typeof window.openai?.sendFollowUpMessage === 'function') await window.openai.sendFollowUpMessage({ prompt }); else await request('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] }); }
      catch { notice = 'Type in the chat what you want to change.'; redraw(); }
      return;
    }
    const args = kind === 'save' ? collectEdits() : { automation_id: current.automation_id, on: !current.on };
    busy = true; notice = ''; redraw();
    try {
      const result = await callTool(kind === 'save' ? 'update_comment_automation' : 'set_comment_automation', args);
      const data = resultData(result) || resultData({ structuredContent: result?.structuredContent || result });
      busy = false;
      if (data?.card) { editing = false; notice = kind === 'save' ? 'Saved.' : (data.card.on ? 'Turned on.' : 'Turned off.'); lastKey = ''; draw(data.card, true); return; }
      const failed = (result && (result.structuredContent || result)) || {};
      notice = failed.next_step || 'That did not work. Try again.';
      redraw();
    } catch { busy = false; notice = 'Hansora could not be reached. Try again.'; redraw(); }
  }
  function redraw() { if (current) { lastKey = ''; draw(current, true); } }

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


  const DAY_NAMES = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
  const mins = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const dur = (m) => (m >= 60 && m % 60 === 0 ? (m / 60) + ' h' : m + ' min');
  function tools(c) {
    current = c;
    if (editing) return toolsEditor(c);
    const t = c.tools || {}, alerts = c.alerts || {}, changed = new Set(c.changed || []);
    const keyOf = { orders: 'orders', bookings: 'bookings', leads: 'leads', handoff_to_person: 'handoff_to_person', products: 'products' };
    const pills = [['orders', 'Orders'], ['bookings', 'Bookings'], ['leads', 'Leads'], ['handoff_to_person', 'Handoff'], ['products', 'Products']].map(([key, name], i) => {
      const status = t[key]?.status || 'not set up';
      return '<div class="pill' + (status === 'on' ? ' on' : '') + '" style="animation-delay:' + (100 + i * 70) + 'ms"><i></i><b>' + name + '</b><span>' + (status === 'on' ? 'On' : status === 'off' ? 'Off' : 'Not set up') + '</span></div>';
    }).join('');
    let delay = 420;
    const panel = (key, title, side, inner) => { const html = '<div class="panel' + (changed.has(key) ? ' changed' : '') + '" style="animation-delay:' + delay + 'ms"><div class="panel-head"><b>' + title + '</b><span>' + esc(side || '') + '</span></div>' + inner + '</div>'; delay += 140; return html; };
    const chips = (list) => list.length ? '<div class="mini">' + list.map((x, i) => '<span style="animation-delay:' + (delay + 120 + i * 50) + 'ms">' + x + '</span>').join('') + '</div>' : '';
    // Bookings: the week drawn as a 24-hour timeline.
    const b = t.bookings || {};
    let bookingsHtml = '';
    if (b.opening_hours) {
      const today = (new Date().getDay() + 6) % 7;
      const rows = DAY_NAMES.map(([key, name], i) => {
        const ranges = b.opening_hours[key] || [];
        const bars = ranges.map((r) => { const from = mins(r.start), to = mins(r.end); return '<i style="left:' + (from / 14.4) + '%;width:' + ((to - from) / 14.4) + '%;animation-delay:' + (delay + 150 + i * 70) + 'ms"></i>'; }).join('');
        const now = i === today ? ' now" style="--now:' + ((new Date().getHours() * 60 + new Date().getMinutes()) / 14.4) + '%' : '';
        return '<div class="day"><span>' + name + '</span><div class="track' + now + '">' + bars + '</div><span>' + (ranges.length ? ranges.map((r) => r.start + '–' + r.end).join(', ') : 'Closed') + '</span></div>';
      }).join('');
      const rules = [dur(b.booking_length_minutes || 60) + ' <em>long</em>', '<em>every</em> ' + dur(b.start_every_minutes || 60)];
      if (b.break_between_minutes) rules.push(dur(b.break_between_minutes) + ' <em>break</em>');
      if (b.minimum_notice_minutes) rules.push(dur(b.minimum_notice_minutes) + ' <em>notice</em>');
      rules.push(fmt(b.at_the_same_time || 1) + ' <em>' + (b.counted_by === 'people' ? 'people' : 'at a time') + '</em>');
      const services = (b.services || []).map((x) => esc(x.name) + ' <em>' + dur(x.length_minutes) + '</em>');
      const team = (b.team_member_names || []).map((n) => '👤 ' + esc(n));
      const off = (b.days_off || []).slice(0, 6).map((d) => '⛱ ' + esc(new Date(d + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
      bookingsHtml = panel('bookings', 'Bookings', b.timezone, '<div class="week">' + rows + '</div><div class="ticks"><span></span><div><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div><span></span></div>' + chips(rules) + chips(services) + chips(team) + chips(off));
    }
    const o = t.orders || {};
    const ordersInner = '<div class="qs">' + (o.questions_asked_before_every_order || []).map((q, i) => '<span style="animation-delay:' + (delay + 100 + i * 60) + 'ms">' + esc(q) + '</span>').join('') + '</div>' + chips([o.new_orders_confirmed_automatically ? '✓ <em>confirmed automatically</em>' : '<em>team confirms each order</em>', o.delivery_time_slots?.on ? '🚚 ' + fmt(o.delivery_time_slots.deliveries_at_the_same_time) + ' <em>per</em> ' + dur(o.delivery_time_slots.per_minutes) : '', o.extra_rules_for_the_ai ? '📝 <em>extra rules set</em>' : ''].filter(Boolean));
    const ordersHtml = panel('orders', 'Questions before an order', o.status === 'on' ? 'On' : 'Off', ordersInner);
    const h = t.handoff_to_person || {}, w = h.hand_over_when || {};
    const handoffInner = '<div class="checks">' + [['customer_asks_for_a_person', 'Customer asks for a person'], ['customer_complains', 'Complaint or refund'], ['information_is_missing', 'A price or detail is missing'], ['ai_is_unsure', 'The AI is unsure']].map(([k, n], i) => '<span class="' + (w[k] ? 'ck-yes' : 'ck-no') + '" style="animation-delay:' + (delay + 100 + i * 70) + 'ms">' + n + '</span>').join('') + '</div>';
    const l = t.leads || {};
    const leadsInner = (l.questions || []).length ? '<div class="qs">' + l.questions.map((q, i) => '<span style="animation-delay:' + (delay + 100 + i * 60) + 'ms">' + esc(q) + '</span>').join('') + '</div>' : '<p class="sub">No questions yet.</p>';
    const handoffHtml = panel('handoff_to_person', 'Hand over to a person when', h.status === 'on' ? 'On' : 'Off', handoffInner);
    const leadsHtml = panel('leads', 'Lead questions', l.status === 'on' ? 'On' : 'Off', leadsInner);
    const labels = c.alert_labels || {};
    const alertsInner = chips([(alerts.email?.on ? '✉ ' + esc(alerts.email.address || 'Email on') : '✉ <em>email off</em>'), (alerts.whatsapp?.on ? '💬 ' + esc(alerts.whatsapp.number) : '💬 <em>WhatsApp off</em>')].concat((alerts.alert_me_about || []).map((e) => '🔔 ' + esc(labels[e] || e))));
    const alertsHtml = panel('alerts', 'Alerts to you', '', alertsInner);
    root.innerHTML = head('Business tools', c.employee || '', changed.size ? '<span class="badge on"><i></i>Saved</span>' : '<span class="badge"><i></i>' + fmt(['orders', 'bookings', 'leads', 'handoff_to_person', 'products'].filter((k) => t[k]?.status === 'on').length) + ' on</span>')
      + '<div class="body"><h2>What your AI employee can do</h2><div class="pills">' + pills + '</div>'
      + bookingsHtml + ordersHtml + '<div class="two">' + handoffHtml + leadsHtml + '</div>' + alertsHtml
      + (notice ? '<p class="notice">' + esc(notice) + '</p>' : '')
      + '<div class="foot"><span class="muted">Change anything here, or ask in the chat.</span><div class="actions">' + (c.ai_employee_id && canCall() ? '<button class="btn" data-act="edit">✎ Edit</button>' : '') + (c.settings_url ? '<button class="btn ghost" data-link="' + esc(c.settings_url) + '">Open settings</button>' : '') + '</div></div></div>';
  }

  // ---------- Business tools editor (Save writes to Hansora through set_alerts and set_business_tools) ----------
  const sw = (name, on, label) => '<label class="switch"><input type="checkbox" data-field="' + name + '"' + (on ? ' checked' : '') + '><span></span>' + esc(label) + '</label>';
  const numField = (name, value, label, min, max) => '<label class="small">' + esc(label) + '<input class="input" type="number" data-field="' + name + '" value="' + esc(value ?? '') + '" min="' + min + '" max="' + max + '"></label>';
  const lines = (list) => (list || []).join('\n');
  function toolsEditor(c) {
    const t = c.tools || {}, a = c.alerts || {}, b = t.bookings || {}, o = t.orders || {}, l = t.leads || {}, h = t.handoff_to_person || {}, w = h.hand_over_when || {};
    const slots = o.delivery_time_slots || {};
    const days = DAY_NAMES.map(([key, name]) => {
      const ranges = (b.opening_hours || {})[key] || [];
      const r1 = ranges[0] || { start: '10:00', end: '19:00' }, r2 = ranges[1];
      return '<div class="day-edit"><label class="switch"><input type="checkbox" data-field="open:' + key + '"' + (ranges.length ? ' checked' : '') + '><span></span>' + name + '</label>'
        + '<input class="input" type="time" data-field="from1:' + key + '" value="' + esc(r1.start) + '"><input class="input" type="time" data-field="to1:' + key + '" value="' + esc(r1.end) + '">'
        + '<input class="input" type="time" data-field="from2:' + key + '" value="' + esc(r2?.start || '') + '" title="Second part of the day (optional)"><input class="input" type="time" data-field="to2:' + key + '" value="' + esc(r2?.end || '') + '"></div>';
    }).join('');
    const labels = c.alert_labels || {};
    root.innerHTML = head('Edit business tools', c.employee || '', '<span class="badge"><i></i>Editing</span>')
      + '<div class="body editor">'
      + '<div class="edit-block"><b>What it may do</b><div class="switches">' + sw('on:orders', t.orders?.status === 'on', 'Orders') + sw('on:bookings', b.status === 'on', 'Bookings') + sw('on:leads', l.status === 'on', 'Leads') + sw('on:handoff_to_person', h.status === 'on', 'Handoff') + sw('on:products', t.products?.status === 'on', 'Products') + '</div></div>'
      + '<div class="edit-block"><b>Bookings · opening hours</b><p class="hint">Second pair of times splits the day (for a lunch break). Leave it empty for one range.</p>' + days
      + '<div class="grid4">' + numField('length', b.booking_length_minutes, 'Length (min)', 5, 1440) + numField('every', b.start_every_minutes, 'Starts every (min)', 5, 1440) + numField('break', b.break_between_minutes, 'Break (min)', 0, 240) + numField('notice', b.minimum_notice_minutes, 'Notice (min)', 0, 43200) + '</div>'
      + '<div class="grid4">' + numField('same', b.at_the_same_time, 'At the same time', 1, 5000) + numField('ahead', b.book_up_to_days_ahead, 'Days ahead', 1, 365) + numField('last', b.last_booking_minutes_before_closing, 'Last start before close (min, empty = end by close)', 0, 240) + '<label class="small">Time zone' + field('timezone', b.timezone || '', 'placeholder="Europe/London"') + '</label></div>'
      + '<label>Team member names <small>one per line, customers can choose one</small>' + area('team', lines(b.team_member_names), 'rows="2"') + '</label>'
      + '<label>Services <small>one per line: name, minutes</small>' + area('services', (b.services || []).map((x) => x.name + ', ' + x.length_minutes).join('\n'), 'rows="2" placeholder="Consultation, 30"') + '</label>'
      + '<label>Days off <small>one per line, YYYY-MM-DD</small>' + area('daysoff', lines(b.days_off), 'rows="2" placeholder="2026-12-25"') + '</label>'
      + '<label>Questions before a booking <small>one per line</small>' + area('bq', lines(b.questions_asked_before_every_booking), 'rows="2"') + '</label>'
      + sw('bauto', b.new_bookings_confirmed_automatically, 'Confirm bookings automatically')
      + '<label>Extra rules for the AI' + area('brules', b.extra_rules_for_the_ai || '', 'rows="2"') + '</label></div>'
      + '<div class="edit-block"><b>Orders</b><label>Questions before an order <small>one per line</small>' + area('oq', lines(o.questions_asked_before_every_order), 'rows="4"') + '</label>'
      + sw('oauto', o.new_orders_confirmed_automatically, 'Mark new orders as confirmed')
      + '<label>Message after the order <small>{number} becomes the order number</small>' + area('omsg', o.message_after_the_order || '', 'rows="2"') + '</label>'
      + '<label>Extra rules for the AI' + area('orules', o.extra_rules_for_the_ai || '', 'rows="2"') + '</label>'
      + sw('slots', slots.on, 'Delivery time slots') + '<div class="grid4">' + numField('per', slots.deliveries_at_the_same_time || 1, 'Deliveries at once', 1, 500) + numField('window', slots.per_minutes || 30, 'Per (min)', 5, 240) + numField('lead', slots.earliest_minutes_after_ordering ?? 30, 'Earliest after order (min)', 0, 1440) + '</div></div>'
      + '<div class="edit-block"><b>Leads</b><label>Questions <small>one per line</small>' + area('lq', lines(l.questions), 'rows="2"') + '</label><label>What makes someone a serious buyer?' + area('signals', l.signs_of_an_interested_customer || '', 'rows="2"') + '</label></div>'
      + '<div class="edit-block"><b>Hand over to a person when</b><div class="switches">' + sw('h:customer_asks_for_a_person', w.customer_asks_for_a_person, 'Customer asks for a person') + sw('h:customer_complains', w.customer_complains, 'Complaint or refund') + sw('h:information_is_missing', w.information_is_missing, 'A price or detail is missing') + sw('h:ai_is_unsure', w.ai_is_unsure, 'The AI is unsure') + '</div><label>Message for a reel from another account' + area('reel', h.message_for_a_reel_from_another_account || '', 'rows="2"') + '</label></div>'
      + '<div class="edit-block"><b>Alerts to you</b><div class="switches">' + sw('aemail', a.email?.on, 'Email') + (a.whatsapp?.verified ? sw('awa', a.whatsapp?.on, 'WhatsApp ' + (a.whatsapp.number || '')) : '') + '</div><label>Email address' + field('aaddr', a.email?.address || '', 'type="email"') + '</label><div class="switches">' + Object.entries(labels).map(([k, n]) => sw('ev:' + k, (a.alert_me_about || []).includes(k), n)).join('') + '</div>' + (a.whatsapp?.verified ? '' : '<p class="hint">To get alerts on WhatsApp, ask in the chat: it sends you a code.</p>') + '</div>'
      + (notice ? '<p class="notice">' + esc(notice) + '</p>' : '')
      + '<div class="foot"><span class="muted">Google Calendar is connected on the website.</span><div class="actions"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn" data-act="save-tools"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save') + '</button></div></div></div>';
  }
  function collectTools() {
    const f = (name) => root.querySelector('[data-field="' + CSS.escape(name) + '"]');
    const val = (name) => f(name)?.value ?? '';
    const on = (name) => Boolean(f(name)?.checked);
    const list = (name) => val(name).split('\n').map((x) => x.trim()).filter(Boolean);
    const n = (name) => (val(name) === '' ? undefined : Number(val(name)));
    const t = current.tools || {}, b = t.bookings || {}, o = t.orders || {}, l = t.leads || {}, h = t.handoff_to_person || {};
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const out = {}, put = (key, value, before) => { if (value !== undefined && !same(value, before)) out[key] = value; };
    for (const key of ['orders', 'bookings', 'leads', 'handoff_to_person', 'products']) put(key, on('on:' + key), t[key]?.status === 'on');
    const hours = {};
    DAY_NAMES.forEach(([key]) => {
      const ranges = [];
      if (on('open:' + key)) { if (val('from1:' + key) && val('to1:' + key)) ranges.push({ start: val('from1:' + key), end: val('to1:' + key) }); if (val('from2:' + key) && val('to2:' + key)) ranges.push({ start: val('from2:' + key), end: val('to2:' + key) }); }
      if (!same(ranges, (b.opening_hours || {})[key] || [])) hours[key] = ranges;
    });
    if (Object.keys(hours).length) out.opening_hours = hours;
    put('booking_length_minutes', n('length'), b.booking_length_minutes); put('start_every_minutes', n('every'), b.start_every_minutes);
    put('break_between_minutes', n('break') ?? 0, b.break_between_minutes || 0); put('minimum_notice_minutes', n('notice') ?? 0, b.minimum_notice_minutes || 0);
    put('book_up_to_days_ahead', n('ahead'), b.book_up_to_days_ahead);
    put('last_booking_minutes_before_closing', val('last') === '' ? null : Number(val('last')), b.last_booking_minutes_before_closing ?? null);
    put('booking_timezone', val('timezone').trim() || undefined, b.timezone);
    put('team_member_names', list('team'), b.team_member_names || []);
    if (!(list('team').length)) put('at_the_same_time', n('same'), b.at_the_same_time);
    put('services', list('services').map((line) => { const [name, minutes] = line.split(',').map((x) => x.trim()); return { name, length_minutes: Number(minutes) || b.booking_length_minutes || 60 }; }), (b.services || []).map((x) => ({ name: x.name, length_minutes: x.length_minutes })));
    put('days_off', list('daysoff'), b.days_off || []);
    put('booking_questions', list('bq'), b.questions_asked_before_every_booking || []);
    put('bookings_confirmed_automatically', on('bauto'), Boolean(b.new_bookings_confirmed_automatically));
    put('booking_extra_rules', val('brules').trim(), b.extra_rules_for_the_ai || '');
    put('order_questions', list('oq'), o.questions_asked_before_every_order || []);
    put('orders_confirmed_automatically', on('oauto'), Boolean(o.new_orders_confirmed_automatically));
    put('message_after_the_order', val('omsg').trim(), o.message_after_the_order || '');
    put('order_extra_rules', val('orules').trim(), o.extra_rules_for_the_ai || '');
    const slots = { on: on('slots'), deliveries_at_the_same_time: n('per') || 1, per_minutes: n('window') || 30, earliest_minutes_after_ordering: n('lead') ?? 30 };
    const oldSlots = o.delivery_time_slots?.on ? o.delivery_time_slots : { on: false, deliveries_at_the_same_time: 1, per_minutes: 30, earliest_minutes_after_ordering: 30 };
    if (!same(slots, { on: Boolean(oldSlots.on), deliveries_at_the_same_time: oldSlots.deliveries_at_the_same_time, per_minutes: oldSlots.per_minutes, earliest_minutes_after_ordering: oldSlots.earliest_minutes_after_ordering })) out.delivery_time_slots = slots;
    put('lead_questions', list('lq'), l.questions || []);
    put('signs_of_an_interested_customer', val('signals').trim(), l.signs_of_an_interested_customer || '');
    const rules = Object.fromEntries(['customer_asks_for_a_person', 'customer_complains', 'information_is_missing', 'ai_is_unsure'].map((k) => [k, on('h:' + k)]));
    put('hand_over_when', rules, h.hand_over_when || {});
    put('message_for_a_reel_from_another_account', val('reel').trim(), h.message_for_a_reel_from_another_account || '');
    const a = current.alerts || {}, alerts = {};
    if (on('aemail') !== Boolean(a.email?.on)) alerts.email_on = on('aemail');
    if (val('aaddr').trim() !== (a.email?.address || '')) alerts.email = val('aaddr').trim();
    if (f('awa') && on('awa') !== Boolean(a.whatsapp?.on)) alerts.whatsapp_on = on('awa');
    const events = Object.keys(current.alert_labels || {}).filter((k) => on('ev:' + k));
    if (!same([...events].sort(), [...(a.alert_me_about || [])].sort())) alerts.alert_me_about = events;
    return { tools: out, alerts };
  }
  async function saveTools() {
    const { tools: changes, alerts } = collectTools();
    if (!Object.keys(changes).length && !Object.keys(alerts).length) { editing = false; notice = 'Nothing changed.'; return redraw(); }
    busy = true; notice = ''; redraw();
    const failure = (result) => (result && (result.structuredContent || result)) || {};
    try {
      if (Object.keys(alerts).length) {
        const saved = await callTool('set_alerts', { ai_employee_id: current.ai_employee_id, ...alerts });
        if (failure(saved).ok === false || saved?.isError) { busy = false; notice = failure(saved).next_step || 'The alerts could not be saved.'; return redraw(); }
      }
      const result = await callTool(Object.keys(changes).length ? 'set_business_tools' : 'get_business_tools', { ai_employee_id: current.ai_employee_id, ...changes });
      const data = resultData(result) || resultData({ structuredContent: result?.structuredContent || result });
      busy = false;
      if (data?.card) { editing = false; notice = 'Saved to Hansora.'; lastKey = ''; draw(data.card, false); return; }
      notice = failure(result).next_step || 'That did not work. Try again.'; redraw();
    } catch { busy = false; notice = 'Hansora could not be reached. Try again.'; redraw(); }
  }

  const VIEWS = { overview, automation, product, employee, call, tools };
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
  function draw(card, keepState) {
    if (!card || !VIEWS[card.type]) return;
    const key = JSON.stringify(card);
    if (key === lastKey) return;
    lastKey = key;
    if (!keepState && (card.type !== current?.type || (card.automation_id || card.ai_employee_id) !== (current?.automation_id || current?.ai_employee_id))) { editing = false; notice = ''; }
    VIEWS[card.type](card);
    root.querySelectorAll('[data-link]').forEach((button) => button.addEventListener('click', () => openLink(button.dataset.link)));
    root.querySelectorAll('[data-act]').forEach((button) => button.addEventListener('click', () => act(button.dataset.act)));
    root.classList.toggle('still', Boolean(keepState));
    if (!keepState) animateNumbers();
    setTimeout(reportSize, 30); setTimeout(reportSize, 1800);
  }
  function render(result) { draw(resultData(result)?.card); }
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
        'openai/widgetDescription': 'A card with the result: animated chat numbers, a comment automation drawn step by step, business tools with the week drawn as a timeline, a product, an AI employee or a phone call.',
        'openai/widgetCSP': { connect_domains: [], resource_domains: [] }
      }
    }]
  };
}

export const CARD_TOOL_META = (invoking, invoked, { fromCard = false } = {}) => ({
  ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] },
  'openai/outputTemplate': CARD_URI,
  ...(fromCard ? { 'openai/widgetAccessible': true } : {}),
  'openai/toolInvocation/invoking': invoking,
  'openai/toolInvocation/invoked': invoked
});

// ---------- What each tool puts in `card` ----------

const STEP_TITLES = { comment: 'Someone comments', reply: 'Public reply', dm: 'Private message', check: 'Follower check', follow: 'If they do not follow', link: 'If they follow' };
const buttonsOf = step => (step?.actions || []).filter(action => action?.label).map(action => ({ id: action.id, label: action.label, ...(action.type === 'website' ? { url: action.url || '' } : {}) }));
const messageStep = (step, kind, title) => ({ kind, title, id: step?.id || '', text: step?.text || '', buttons: buttonsOf(step) });
export function automationCard(row, view, editUrl) {
  const steps = Array.isArray(row.dm_steps) ? row.dm_steps : [];
  const byId = Object.fromEntries(steps.map(step => [step.id, step]));
  const flow = [{ kind: 'comment', title: STEP_TITLES.comment, text: view.reacts_to }];
  const tiktok = view.platform === 'TikTok';
  if (view.public_replies?.length || tiktok) flow.push({ kind: 'reply', title: STEP_TITLES.reply, text: (view.public_replies || []).join('  ·  ') });
  const opening = steps.find(step => step.commentReply || step.entry) || steps.find(step => step.type === 'message');
  if (opening) flow.push(messageStep(opening, 'dm', STEP_TITLES.dm));
  const check = steps.find(step => step.type === 'condition' && (step.rules || []).some(rule => rule.field === 'follows'));
  if (check) {
    flow.push({ kind: 'check', title: STEP_TITLES.check, text: 'Do they follow your account?' });
    flow.push({ branch: true, yes: messageStep(byId[check.yesId], 'link', STEP_TITLES.link), no: messageStep(byId[check.noId], 'follow', STEP_TITLES.follow) });
  } else if (steps.length > 1) {
    flow.push({ kind: 'more', title: `${steps.length - 1} more step${steps.length > 2 ? 's' : ''}`, text: 'Open the builder to see the whole flow.' });
  }
  return {
    type: 'automation', automation_id: row.id, name: view.name, platform: tiktok ? 'tiktok' : 'instagram', on: view.status === 'on',
    match: row.match_type, reacts_to: view.reacts_to, keywords: row.match_type === 'any' ? [] : (row.keywords || []), public_replies: view.public_replies || [],
    posts: view.posts, steps: flow, edit_url: editUrl
  };
}
