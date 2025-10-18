// netlify/edge-functions/inject-bottom-nav-inline.js
// Inject the exact same mobile bottom nav + overlay used on index.html
// Rules followed: do not change anything else; preserve existing behavior; no auth/login logic touched.

export default async (request, context) => {
  // 1) Let the origin render first
  const res = await context.next();

  // 2) Only touch HTML responses
  const headers = new Headers(res.headers);
  const ct = headers.get('content-type') || '';
  if (!ct.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers });
  }

  // 3) Read HTML
  const html = await res.text();

  // 4) If the page already has hs-bottom-nav, don't inject twice
  if (html.includes('class="hs-bottom-nav"') || html.includes("class='hs-bottom-nav'")) {
    return new Response(html, { status: res.status, headers });
  }

  // 5) Style copied to match index.html exactly (mobile-only)
  const STYLE = `
<style id="hs-nav-inline">
  .hs-bottom-nav, .hs-overlay { display: none; }
  @media (max-width: 768px){
    :root{
      --hs-bg: rgba(12,14,20,0.88);
      --hs-ink: #e5e7eb;
      --hs-muted: #9ca3af;
      --hs-line: rgba(255,255,255,0.08);
      --hs-grad-a: #8b5cf6;
      --hs-grad-b: #60a5fa;
    }
    body{ padding-bottom: 84px; }
    .hs-bottom-nav{
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
      background: var(--hs-bg); border-top: 1px solid var(--hs-line);
      backdrop-filter: saturate(120%) blur(12px); display:block;
    }
    .hs-bottom-rail{
      max-width: 980px; margin: 0 auto; height: 64px;
      display: grid; grid-template-columns: 1fr 1fr auto 1fr 1fr;
      align-items: center; padding: 0 14px;
    }
    .hs-btn{
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 4px; text-decoration: none; color: var(--hs-muted); font-size: 11px; padding: 8px 4px;
      border-radius: 12px;
    }
    .hs-btn:active{ background: rgba(255,255,255,0.06); }
    .hs-btn svg{ width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; }
    .hs-fab-wrap{ display: flex; justify-content: center; align-items: center; }
    .hs-fab{
      width: 64px; height: 64px; margin-top: -28px; border-radius: 16px;
      display: flex; align-items: center; justify-content: center; position: relative;
      text-decoration: none; color: #fff; font-weight: 700; font-size: 12px;
      background: radial-gradient(120% 120% at 20% 10%, var(--hs-grad-a) 0%, #6d28d9 50%, transparent 60%),
                  radial-gradient(140% 140% at 80% 80%, var(--hs-grad-b) 0%, #1d4ed8 55%, transparent 65%),
                  linear-gradient(180deg, var(--hs-grad-a), var(--hs-grad-b));
      box-shadow: 0 10px 30px rgba(139,92,246,0.35), 0 6px 14px rgba(59,130,246,0.25);
      border: 1px solid var(--hs-line);
    }
    /* Overlay */
    .hs-overlay{ position: fixed; inset: 0; display:none; }
    .hs-overlay.is-open{ display:block; }
    .hs-overlay .backdrop{ position:absolute; inset:0; background: rgba(0,0,0,0.5); }
    .hs-overlay .panel{
      position:absolute; left:0; right:0; bottom:0;
      background: rgba(10,12,16,0.98);
      border-top-left-radius: 16px; border-top-right-radius: 16px;
      border-top: 1px solid var(--hs-line);
      padding: 16px 16px 24px;
    }
    .hs-overlay .panel header{
      display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px;
    }
    .hs-overlay .panel header h3{ font-size: 16px; color: var(--hs-ink); }
    .hs-overlay .panel header button{
      width: 32px; height: 32px; border-radius: 10px; display:grid; place-items:center;
      background: rgba(255,255,255,0.06); border: 1px solid var(--hs-line);
    }
    .hs-overlay .panel header button svg{
      width: 22px; height: 22px; display:block;
    }
    .hs-overlay .panel header button svg path{
      stroke: #ffffff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .hs-overlay .links{ display:flex; flex-direction:column; gap:10px; }
    .hs-overlay .links a{
      display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--hs-ink);
      padding: 10px 10px; border-radius: 12px; border: 1px solid var(--hs-line);
      background: rgba(255,255,255,0.02);
    }
    .hs-overlay .links a svg{ width:22px; height:22px; stroke:currentColor; fill:none; stroke-width:2; }
  }
</style>`;

  // 6) Exact HTML for the bottom nav + overlay (copied from index.html)
  const NAV = `
<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a aria-label="Home" class="hs-btn" href="index.html">
      <svg viewBox="0 0 24 24"><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4H9v4a2 2 0 0 1-2 2H3z"/></svg>
      <span>Home</span>
    </a>
    <a aria-label="Templates" class="hs-btn" href="templates.html">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>
      <span>Templates</span>
    </a>
    <a aria-label="Models" class="hs-fab" href="models.html">
      <svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>
      <span>Models</span>
    </a>
    <a aria-label="History" class="hs-btn" href="usage.html">
      <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.708"/><path d="M3 3v6h6"/><path d="M12 7v6l4 2"/></svg>
      <span>History</span>
    </a>
    <button aria-label="Menu" class="hs-btn" id="hs-menu-btn" type="button">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      <span>Menu</span>
    </button>
  </div>
</nav>
<div class="hs-overlay" id="hs-overlay">
  <div class="backdrop" id="hs-backdrop"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="hs-ol-title">
    <header>
      <h3 id="hs-ol-title">Quick Links</h3>
      <button aria-label="Close" id="hs-close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6"></path></svg>
      </button>
    </header>
    <div class="links">
      <a href="models.html"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg> Models</a>
      <a href="templates.html"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg> Templates</a>
      <a href="examples-prompts.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v12H4z"></path><path d="M8 20h8"></path></svg> Examples/Prompts</a>
      <a href="pricing.html"><svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"></path><path d="M8 10h8M8 14h8"></path></svg> Pricing</a>
      <a href="index.html#faq"><svg viewBox="0 0 24 24"><path d="M12 18v.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> FAQ</a>
      <a href="contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M4 8l8 6 8-6"/></svg> Contact</a>
    </div>
  </div>
</div>
<script>
  (function(){
    try {
      // Mobile-only guard
      var mql = window.matchMedia && window.matchMedia('(max-width: 768px)');
      if (!mql || !mql.matches) return;

      // Active state: treat "/" and "/index.html" as same
      var path = location.pathname.replace(/\\/$/, '') || '/index.html';
      if (path === '') path = '/index.html';
      document.querySelectorAll('.hs-bottom-nav a.hs-btn, .hs-bottom-nav a.hs-fab').forEach(function(a){
        var href = a.getAttribute('href') || '';
        if (!href) return;
        var u = new URL(href, location.origin);
        var target = u.pathname.replace(/\\/$/, '');
        if (target === '' || target === '/') target = '/index.html';
        if (target === path) a.classList.add('active');
      });

      // Menu overlay
      var openBtn = document.getElementById('hs-menu-btn');
      var overlay = document.getElementById('hs-overlay');
      var closeBtn = document.getElementById('hs-close');
      var backdrop = document.getElementById('hs-backdrop');
      function open(){ overlay.classList.add('is-open'); document.body.classList.add('no-scroll'); }
      function close(){ overlay.classList.remove('is-open'); document.body.classList.remove('no-scroll'); }
      openBtn && openBtn.addEventListener('click', open);
      closeBtn && closeBtn.addEventListener('click', close);
      backdrop && backdrop.addEventListener('click', close);
      document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
      (overlay.querySelectorAll('.links a') || []).forEach(function(a){ a.addEventListener('click', close); });
      // Expose helpers (matching index)
      window.__hs_menu_open = open;
      window.__hs_menu_close = close;
    } catch(e) { /* no-op */ }
  })();
</script>`;

  // 7) Append before </body>
  const injected = html.replace('</body>', `${STYLE}${NAV}</body>`);

  return new Response(injected, { status: res.status, headers });
};
