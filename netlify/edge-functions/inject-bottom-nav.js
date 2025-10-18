export default async (request, context) => {
  const res = await context.next();
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const navHtml = `
<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a aria-label="Home" class="hs-btn" href="/index.html">
      <svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>
      <span>Home</span>
    </a>
    <a aria-label="Templates" class="hs-btn" href="/templates.html">
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect>
        <rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect>
      </svg>
      <span>Templates</span>
    </a>
    <div class="hs-fab-wrap">
      <a aria-label="Models" class="hs-fab" href="/models.html">
        <svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg>
        <span>Models</span>
      </a>
    </div>
    <a aria-label="History" class="hs-btn" href="/usage.html">
      <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.708"></path><path d="M3 3v6h6"></path><path d="M12 7v6l4 2"></path></svg>
      <span>History</span>
    </a>
    <button aria-label="Menu" class="hs-btn" id="hs-menu-btn" type="button">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
      <span>Menu</span>
    </button>
  </div>
</nav>
<div class="hs-overlay" id="hs-overlay">
  <div class="backdrop" id="hs-backdrop"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="hs-ol-title">
    <header>
      <h3 id="hs-ol-title">Quick Links</h3>
      <button id="hs-close" aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6"></path></svg>
      </button>
    </header>
    <div class="links">
      <a href="/models.html"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg> Models</a>
      <a href="/templates.html"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg> Templates</a>
      <a href="/examples-prompts.html"><svg viewBox="0 0 24 24"><path d="M6 4h12v16H6z"></path><path d="M8 20h8"></path></svg> Examples/Prompts</a>
      <a href="/pricing.html"><svg viewBox="0 0 24 24"><path d="M3 7h18v10H3z"></path><path d="M8 10h8M8 14h8"></path></svg> Pricing</a>
      <a href="/index.html#faq"><svg viewBox="0 0 24 24"><path d="M12 17h.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> FAQ</a>
      <a href="/contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path><path d="M4 8l8 6 8-6"></path></svg> Contact</a>
    </div>
  </div>
</div>
<script>
(function(){
  // No-op on desktop (CSS hides everything above 768px)
  const openBtn = document.getElementById('hs-menu-btn');
  const overlay = document.getElementById('hs-overlay');
  const closeBtn = document.getElementById('hs-close');
  const backdrop = document.getElementById('hs-backdrop');
  function open(){ overlay && overlay.classList.add('is-open'); }
  function close(){ overlay && overlay.classList.remove('is-open'); }
  openBtn && openBtn.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', close);
  backdrop && backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
})();
</script>`;

  return new HTMLRewriter()
    .on('head', {
      element(e) {
        e.append(`<link rel="stylesheet" href="/nav-bottom.css">`, { html: true });
      }
    })
    .on('body', {
      element(e) {
        e.append(navHtml, { html: true });
      }
    })
    .transform(res);
};
