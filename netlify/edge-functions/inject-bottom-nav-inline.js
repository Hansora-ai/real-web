// netlify/edge-functions/inject-bottom-nav-inline.js
// EXACT 1:1 injection of the mobile bottom navigation + overlay from index.html
// No other behavior changed. HTML & CSS copied verbatim from uploaded index file.

export default async (request, context) => {
  const res = await context.next();

  // Only operate on HTML
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const html = await res.text();

  // Avoid duplicate injection if the page already includes it
  if (html.includes('class="hs-bottom-nav"') || html.includes("class='hs-bottom-nav'")) {
    return new Response(html, { status: res.status, headers: res.headers });
  }

  const STYLE = `<style>
  .hs-bottom-nav, .hs-overlay { display: none; }
  @media (max-width: 768px){
    :root{
      --hs-bg: rgba(12,14,20,.88);
      --hs-ink: #e5e7eb;
      --hs-muted: #9ca3af;
      --hs-line: rgba(255,255,255,.08);
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
    .hs-btn:active{ background: rgba(255,255,255,.06); }
    .hs-btn svg{ width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; }
    .hs-fab-wrap{ display: flex; justify-content: center; align-items: center; }
    .hs-fab{
      width: 64px; height: 64px; margin-top: -28px; border-radius: 16px;
      display: flex; align-items: center; justify-content: center; position: relative;
      text-decoration: none; color: #fff; font-weight: 700; font-size: 12px;
      background: radial-gradient(120% 120% at 20% 10%, var(--hs-grad-a) 0%, #6d28d9 50%, transparent 60%),
                  radial-gradient(140% 140% at 80% 80%, var(--hs-grad-b) 0%, #1d4ed8 55%, transparent 65%),
                  linear-gradient(180deg, #7c3aed, #2563eb);
      box-shadow: 0 10px 30px rgba(139,92,246,.35), 0 6px 14px rgba(37,99,235,.25);
      border: 1px solid rgba(255,255,255,.08);
    }
    .hs-fab svg{ width: 26px; height: 26px; stroke: #fff; }
    .hs-fab span{ position: absolute; bottom: 6px; font-size: 10px; }
    .hs-overlay{ position: fixed; inset: 0; z-index: 70; display: none; }
    .hs-overlay.is-open{ display: block; }
    .hs-overlay .backdrop{ position: absolute; inset: 0; background: rgba(0,0,0,.6); }
    .hs-overlay .panel{ position: absolute; inset: 0; background: rgba(12,14,20,.98); display: flex; flex-direction: column; }
    .hs-overlay .panel header{ display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--hs-line); color: var(--hs-ink); }
    .hs-overlay .panel header h3{ font-size: 16px; font-weight: 700; letter-spacing: .2px; margin: 0; }
    .hs-overlay .panel header button{ width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--hs-line); background: rgba(255,255,255,.04); color: var(--hs-ink); }
    .hs-overlay .links{ padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .hs-overlay .links a{ display: flex; align-items: center; gap: 10px; padding: 14px 12px; border-radius: 12px; text-decoration: none; color: var(--hs-ink); border: 1px solid var(--hs-line); background: rgba(255,255,255,.04); font-size: 15px; }
    .hs-overlay .links a:active{ background: rgba(255,255,255,.06); }
    .hs-overlay .links svg{ width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2; }
  }
</style>`;
  const NAV = `<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
<div class="hs-bottom-rail">
<a aria-label="Home" class="hs-btn" href="index.html">
<svg viewbox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>
<span>Home</span>
</a>
<a aria-label="Templates" class="hs-btn" href="templates.html">
<svg viewbox="0 0 24 24">
<rect height="7" rx="2" width="7" x="3" y="3"></rect><rect height="7" rx="2" width="7" x="14" y="3"></rect>
<rect height="7" rx="2" width="7" x="3" y="14"></rect><rect height="7" rx="2" width="7" x="14" y="14"></rect>
</svg>
<span>Templates</span>
</a>
<div class="hs-fab-wrap">
<a aria-label="Models" class="hs-fab" href="models.html">
<svg viewbox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg>
<span>Models</span>
</a>
</div>
<a aria-label="History" class="hs-btn" href="usage.html">
<svg viewbox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.708"></path><path d="M3 3v6h6"></path><path d="M12 7v6l4 2"></path></svg>
<span>History</span>
</a>
<button aria-label="Menu" class="hs-btn" id="hs-menu-btn" type="button">
<svg viewbox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
<span>Menu</span>
</button>
</div>
</nav>
<div class="hs-overlay" id="hs-overlay">
<div class="backdrop" id="hs-backdrop"></div>
<div aria-labelledby="hs-ol-title" aria-modal="true" class="panel" role="dialog">
<header>
<h3 id="hs-ol-title">Quick Links</h3>
<button aria-label="Close" id="hs-close">
<svg viewbox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6"></path></svg>
</button>
</header>
<div class="links">
<a href="models.html"><svg viewbox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg> Models</a>
<a href="templates.html"><svg viewbox="0 0 24 24">
<rect height="7" rx="2" width="7" x="3" y="3"></rect><rect height="7" rx="2" width="7" x="14" y="3"></rect>
<rect height="7" rx="2" width="7" x="3" y="14"></rect><rect height="7" rx="2" width="7" x="14" y="14"></rect>
</svg> Templates</a>
<a href="examples-prompts.html"><svg viewbox="0 0 24 24"><path d="M4 4h16v12H4z"></path><path d="M8 20h8"></path></svg> Examples/Prompts</a>
<a href="pricing.html"><svg viewbox="0 0 24 24"><path d="M6 6h12v12H6z"></path><path d="M8 10h8M8 14h8"></path></svg> Pricing</a>
<a href="index.html#faq"><svg viewbox="0 0 24 24"><path d="M12 18v.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> FAQ</a>

      <a href="contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M4 8l8 6 8-6"/></svg> Contact</a>
</div>
</div>
</div>
<script>
  (function(){
    const openBtn = document.getElementById('hs-menu-btn');
    const overlay = document.getElementById('hs-overlay');
    const closeBtn = document.getElementById('hs-close');
    const backdrop = document.getElementById('hs-backdrop');
    function open(){ overlay.classList.add('is-open'); }
    function close(){ overlay.classList.remove('is-open'); }
    openBtn && openBtn.addEventListener('click', open);
    closeBtn && closeBtn.addEventListener('click', close);
    backdrop && backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
  })();
</script>`;

  const out = html.replace('</body>', `${STYLE}${NAV}</body>`);
  return new Response(out, { status: res.status, headers: res.headers });
};
