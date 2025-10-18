// netlify/edge-functions/inject-bottom-nav-inline.js
export default async (request, context) => {
  // Let the origin generate the page first
  const res = await context.next();

  // Add a debug header so we can SEE the edge function is running
  const headers = new Headers(res.headers);
  headers.set('x-hs-edge-ok', '1');

  // Only touch real HTML pages
  const ct = headers.get('content-type') || '';
  if (!ct.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers });
  }

  // Read the HTML
  const html = await res.text();

  // Only for mobile widths; we inject a <style> + <nav> + tiny <script>
  const STYLE = `
<style id="hs-nav-inline">
@media (max-width: 768px){
  :root { --hs-ink:#e5e7eb; --hs-muted:#9ca3af; --hs-line:rgba(255,255,255,.08);
          --hs-grad-a:#8b5cf6; --hs-grad-b:#60a5fa; }
  body{ padding-bottom:84px; }
  .hs-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:60;
    background:linear-gradient(180deg,rgba(10,12,16,.7),rgba(10,12,16,.9));
    -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    border-top:1px solid var(--hs-line);padding:12px 10px 14px;}
  .hs-bottom-rail{max-width:980px;margin:0 auto;height:64px;display:grid;
    grid-template-columns:1fr 1fr auto 1fr 1fr;align-items:center;padding:0 14px;}
  .hs-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:4px;text-decoration:none;color:var(--hs-muted);font-size:11px;padding:8px 4px;
    border-radius:12px;}
  .hs-btn.active{background:rgba(255,255,255,.06);}
  .hs-fab{position:relative;display:grid;place-items:center;width:64px;height:64px;
    border-radius:20px;background:linear-gradient(180deg,var(--hs-grad-a),var(--hs-grad-b));
    box-shadow:0 10px 30px rgba(139,92,246,.35),0 6px 14px rgba(59,130,246,.25);
    color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.08);}
  .hs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);display:none;}
  .hs-overlay.open{display:block;}
}
</style>`;

  const NAV = `
<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a class="hs-btn" href="/index.html"><span>Home</span></a>
    <a class="hs-btn" href="/templates.html"><span>Templates</span></a>
    <a class="hs-fab" href="/models.html"><span>Models</span></a>
    <a class="hs-btn" href="/history.html"><span>History</span></a>
    <button class="hs-btn" id="hs-menu-btn" type="button"><span>Menu</span></button>
  </div>
</nav>
<div class="hs-overlay" id="hs-overlay"></div>
<script>
  (function(){
    try {
      const mql = window.matchMedia && window.matchMedia('(max-width: 768px)');
      if (!mql || !mql.matches) return;
      const path = location.pathname.replace(/\\/$/, '');
      const btns = document.querySelectorAll('.hs-bottom-nav .hs-btn, .hs-bottom-nav .hs-fab');
      btns.forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href) return;
        const uh = new URL(href, location.origin);
        if (uh.pathname === path) a.classList.add('active');
      });
      const menuBtn = document.getElementById('hs-menu-btn');
      const ov = document.getElementById('hs-overlay');
      if (menuBtn && ov){ menuBtn.addEventListener('click', () => ov.classList.toggle('open')); }
    } catch(e) {}
  })();
</script>`;

  const injected = html.replace('</body>', `${STYLE}${NAV}</body>`);
  return new Response(injected, { status: res.status, headers });
};
