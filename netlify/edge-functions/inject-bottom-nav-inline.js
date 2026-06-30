// netlify/edge-functions/inject-bottom-nav-inline.js
// Injects the shared mobile bottom navigation into HTML responses.

export default async (request, context) => {
  const res = await context.next();

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const html = await res.text();

  if (html.includes('class="hs-bottom-nav"') || html.includes("class='hs-bottom-nav'")) {
    return new Response(html, { status: res.status, headers: res.headers });
  }

  const STYLE = `<style>
  .hs-bottom-nav,
  .hs-overlay,
  .hs-radial { display: none; }

  @media (max-width: 768px){
    :root{
      --hs-ink:#e5e7eb;
      --hs-muted:#a9afbd;
      --hs-line:rgba(255,255,255,.10);
      --hs-panel:#111217;
      --hs-panel-2:#171820;
      --hs-grad-a:#8b5cf6;
      --hs-grad-b:#4f9cff;
      --hs-bottom-height:106px;
      --hs-safe-bottom:env(safe-area-inset-bottom, 0px);
    }
    body{ padding-bottom:calc(var(--hs-bottom-height) + var(--hs-safe-bottom)); }
    .hs-bottom-nav{
      position:fixed;
      left:0;
      right:0;
      bottom:0;
      z-index:60;
      display:block;
      box-sizing:border-box;
      isolation:isolate;
      background:#080a0f;
      border-top:1px solid var(--hs-line);
      padding:10px 10px calc(12px + var(--hs-safe-bottom));
      transform:translate3d(0,var(--hs-viewport-shift,0px),0);
      -webkit-transform:translate3d(0,var(--hs-viewport-shift,0px),0);
    }
    .hs-bottom-nav::before{
      content:"";
      position:absolute;
      inset:0;
      z-index:-1;
      background:linear-gradient(180deg,#101219 0%,#080a0f 100%);
    }
    .hs-bottom-nav::after{
      content:"";
      position:absolute;
      left:0;
      right:0;
      top:100%;
      height:max(240px,30vh);
      background:#080a0f;
      pointer-events:none;
    }
    .hs-bottom-rail{
      max-width:780px;
      height:72px;
      margin:0 auto;
      display:grid;
      grid-template-columns:1fr 1fr auto 1fr 1fr;
      align-items:center;
      padding:0 10px;
      gap:4px;
    }
    .hs-btn{
      width:100%;
      min-width:0;
      height:64px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:6px;
      border:0;
      border-radius:16px;
      background:transparent;
      color:var(--hs-muted);
      font:700 12px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      text-decoration:none;
    }
    .hs-btn:active{ background:rgba(255,255,255,.06); color:#fff; }
    .hs-btn svg,
    .hs-overlay svg,
    .hs-radial svg{
      width:26px;
      height:26px;
      stroke:currentColor;
      fill:none;
      stroke-width:2.25;
      stroke-linecap:round;
      stroke-linejoin:round;
    }
    .hs-fab-wrap{ display:flex; justify-content:center; align-items:center; }
    .hs-fab{
      position:relative;
      width:78px;
      height:78px;
      margin-top:-36px;
      display:grid;
      place-items:center;
      border-radius:24px;
      border:1px solid rgba(255,255,255,.18);
      background:
        radial-gradient(circle at 74% 20%, rgba(71,215,255,.9), transparent 24%),
        linear-gradient(145deg,var(--hs-grad-a),#7c3aed 48%,var(--hs-grad-b));
      box-shadow:0 18px 42px rgba(92,82,255,.42), 0 8px 24px rgba(56,189,248,.28);
      color:#fff;
    }
    .hs-fab .hs-fab-plus{
      position:absolute;
      left:0;
      right:0;
      top:11px;
      z-index:2;
      font:300 32px/1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      color:#fff;
    }
    .hs-fab .hs-fab-label{
      position:absolute;
      left:0;
      right:0;
      bottom:10px;
      z-index:2;
      font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    .hs-radial{
      position:fixed;
      inset:0;
      z-index:72;
    }
    .hs-radial.is-open{ display:block; }
    .hs-radial-backdrop{
      position:absolute;
      inset:0;
      background:rgba(0,0,0,.50);
    }
    .hs-radial-panel{
      position:absolute;
      left:50%;
      bottom:0;
      width:min(112vw,520px);
      height:245px;
      transform:translateX(-50%) translateY(32px) scale(.96);
      transform-origin:bottom center;
      border-radius:999px 999px 0 0 / 360px 360px 0 0;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(20,21,25,.98);
      box-shadow:0 -18px 80px rgba(0,0,0,.45);
      opacity:0;
      transition:opacity .22s ease, transform .22s ease;
    }
    .hs-radial.is-open .hs-radial-panel{
      opacity:1;
      transform:translateX(-50%) translateY(0) scale(1);
    }
    .hs-radial-item{
      position:absolute;
      width:78px;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:7px;
      border:0;
      background:transparent;
      color:#d7dbe4;
      text-decoration:none;
      transform:translate(-50%,-50%);
      font:800 13px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    .hs-radial-icon{
      width:50px;
      height:50px;
      display:grid;
      place-items:center;
      border-radius:50%;
      background:#30333b;
      color:#fff;
    }
    .hs-radial-image{ left:28%; top:38%; }
    .hs-radial-video{ left:50%; top:24%; }
    .hs-radial-audio{ left:72%; top:38%; }
    .hs-radial-character{ left:16%; top:70%; }
    .hs-radial-more{ left:84%; top:70%; }
    .hs-radial-close{
      position:absolute;
      left:50%;
      bottom:15%;
      width:58px;
      height:58px;
      transform:translateX(-50%);
      border:0;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:#30333b;
      color:#b9bec9;
    }
    .hs-radial-close svg{ width:32px; height:32px; stroke-width:2.6; }
    .hs-overlay{
      position:fixed;
      inset:0;
      z-index:70;
    }
    .hs-overlay.is-open{ display:block; }
    .hs-overlay .backdrop{
      position:absolute;
      inset:0;
      background:rgba(3,5,10,.74);
      backdrop-filter:blur(4px);
      -webkit-backdrop-filter:blur(4px);
    }
    .hs-overlay .panel{
      position:absolute;
      left:0;
      right:0;
      bottom:0;
      max-height:88vh;
      overflow:auto;
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
      padding:18px 18px calc(26px + env(safe-area-inset-bottom));
      border-radius:28px 28px 0 0;
      border-top:1px solid rgba(255,255,255,.12);
      background:rgba(16,17,23,.98);
      box-shadow:0 -20px 70px rgba(0,0,0,.46);
    }
    .hs-overlay .panel header{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      margin-bottom:14px;
      color:var(--hs-ink);
    }
    .hs-overlay .panel h3{
      margin:0;
      font:850 20px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
    }
    #hs-close{
      flex:0 0 50px;
      width:50px;
      height:50px;
      padding:0;
      border-radius:50%;
      border:1px solid rgba(255,255,255,.12);
      background:#282a32;
      color:#fff;
      display:flex;
      align-items:center;
      justify-content:center;
      box-sizing:border-box;
      line-height:1;
    }
    #hs-close svg{
      width:28px;
      height:28px;
      display:block;
      margin:auto;
    }
    .hs-overlay .links{
      display:flex;
      flex-direction:column;
      gap:10px;
    }
    .hs-overlay .links a,
    .hs-feature-toggle{
      min-height:62px;
      display:flex;
      align-items:center;
      gap:14px;
      padding:0 18px;
      border-radius:18px;
      border:1px solid rgba(255,255,255,.10);
      background:rgba(255,255,255,.04);
      color:var(--hs-ink);
      font:750 16px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      text-decoration:none;
    }
    .hs-feature-toggle{
      width:100%;
      justify-content:space-between;
    }
    .hs-feature-toggle span{
      display:flex;
      align-items:center;
      gap:14px;
    }
    .hs-chev{ transition:transform .18s ease; }
    .hs-overlay.features-open .hs-chev{ transform:rotate(180deg); }
    .hs-feature-list{
      display:none;
      grid-template-columns:1fr;
      gap:8px;
      padding:2px 0 6px 18px;
    }
    .hs-overlay.features-open .hs-feature-list{ display:grid; }
    .hs-feature-list a{
      min-height:46px !important;
      border-radius:14px !important;
      padding:0 14px !important;
      background:rgba(125,211,252,.06) !important;
      font-size:14px !important;
      color:#d8ecff !important;
    }
  }
</style>`;

  const NAV = `<nav aria-label="Mobile bottom navigation" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a aria-label="Home" class="hs-btn" href="/index.html">
      <svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>
      <span>Home</span>
    </a>
    <a aria-label="Features" class="hs-btn" href="/models.html#featuresSection">
      <svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"></path></svg>
      <span>Features</span>
    </a>
    <div class="hs-fab-wrap">
      <button aria-label="Open create menu" class="hs-fab" id="hs-models-btn" type="button">
        <span aria-hidden="true" class="hs-fab-plus">+</span>
        <span class="hs-fab-label">Create</span>
      </button>
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

<div class="hs-radial" id="hs-radial" aria-hidden="true">
  <div class="hs-radial-backdrop" id="hs-radial-backdrop"></div>
  <div class="hs-radial-panel" role="dialog" aria-modal="true" aria-label="Choose model type">
    <a class="hs-radial-item hs-radial-image" href="/search-models.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path><circle cx="8" cy="8" r="1.5"></circle></svg></span>
      <b>Image</b>
    </a>
    <a class="hs-radial-item hs-radial-video" data-hs-video-landing href="/search-models.html?model=kling-3">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg></span>
      <b>Video</b>
    </a>
    <a class="hs-radial-item hs-radial-audio" href="/audio.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path><path d="M21 11v2"></path></svg></span>
      <b>Audio</b>
    </a>
    <a class="hs-radial-item hs-radial-character" href="/character.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg></span>
      <b>Character</b>
    </a>
    <a class="hs-radial-item hs-radial-more" href="/models.html">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"></path><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"></path></svg></span>
      <b>See more</b>
    </a>
    <button class="hs-radial-close" id="hs-radial-close" type="button" aria-label="Close models menu">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
  </div>
</div>

<div class="hs-overlay" id="hs-overlay" aria-hidden="true">
  <div class="backdrop" id="hs-backdrop"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="hs-ol-title">
    <header>
      <h3 id="hs-ol-title">Menu</h3>
      <button id="hs-close" aria-label="Close menu" type="button">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </header>
    <div class="links">
      <a href="/search-models.html"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path></svg> Image</a>
      <a data-hs-video-landing href="/search-models.html?model=kling-3"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg> Video</a>
      <a href="/audio.html"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path></svg> Audio</a>
      <button class="hs-feature-toggle" id="hs-feature-toggle" type="button">
        <span><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path></svg> Features</span>
        <svg class="hs-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
      </button>
      <div class="hs-feature-list" id="hs-feature-list">
        <a href="/upscale.html">Image upscale</a>
        <a href="/expand.html?mode=angles">Full angles</a>
        <a href="/expand.html?mode=expand">Expand</a>
        <a href="/expand.html?mode=face-swap">Face swap</a>
        <a href="/character.html">Character</a>
        <a href="/product_card.html">Product Card</a>
        <a href="/prompt-builder.html">Cartoon Prompt Builder</a>
        <a href="/kid-cartoon.html">Kid Cartoon</a>
        <a href="/video-edit.html">Video Edit</a>
        <a href="/background-change.html">Background Change</a>
        <a href="/upscale.html?mode=video">Video upscale</a>
        <a href="/lipsync.html">Lipsync Avatar</a>
        <a href="/audio.html?tool=text-to-speech">Text to speech</a>
        <a href="/audio.html?tool=voice-isolater">Voice isolater</a>
        <a href="/audio.html?tool=voice-changer">Voice changer</a>
        <a href="/audio.html?tool=song-creation">Song Creation</a>
        <a href="/analyse.html">Hook analyse</a>
        <a href="/models.html">See more</a>
      </div>
      <a href="/pricing.html"><svg viewBox="0 0 24 24"><path d="M3 7h18v10H3z"></path><path d="M8 10h8M8 14h8"></path></svg> Pricing</a>
      <a href="/index.html#faq"><svg viewBox="0 0 24 24"><path d="M12 17h.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> FAQ</a>
      <a href="/contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path><path d="M4 8l8 6 8-6"></path></svg> Contact</a>
    </div>
  </div>
</div>

<script>
  (function(){
    const menuBtn = document.getElementById('hs-menu-btn');
    const overlay = document.getElementById('hs-overlay');
    const closeBtn = document.getElementById('hs-close');
    const backdrop = document.getElementById('hs-backdrop');
    const modelsBtn = document.getElementById('hs-models-btn');
    const radial = document.getElementById('hs-radial');
    const radialBackdrop = document.getElementById('hs-radial-backdrop');
    const radialClose = document.getElementById('hs-radial-close');
    const radialMore = document.getElementById('hs-radial-more');
    const featureToggle = document.getElementById('hs-feature-toggle');
    const bottomNav = document.querySelector('.hs-bottom-nav');
    let lockedScrollY = 0;
    let lockCount = 0;
    let bottomNavShift = 0;
    let bottomNavFrame = 0;
    const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
    let analyticsAuthCache = window.__hansoraAnalyticsAuth || null;
    const refreshAnalyticsAuthCache = () => {
      analyticsAuthCache = null;
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (!/^sb-.*-auth-token$/.test(key || '')) continue;
          const value = JSON.parse(localStorage.getItem(key) || '{}');
          const session = value.currentSession || value.session || value;
          const user = session.user || value.user || {};
          if (session.access_token && user.id) {
            analyticsAuthCache = {
              accessToken: session.access_token,
              userId: user.id,
              email: user.email || null
            };
            break;
          }
        }
      } catch (_) {}
      window.__hansoraAnalyticsAuth = analyticsAuthCache;
      return analyticsAuthCache;
    };
    const readAnalyticsAuth = () => {
      return window.__hansoraAnalyticsAuth || analyticsAuthCache || null;
    };
    const analyticsSessionId = () => {
      const key = 'hansora.analytics.session_id';
      try {
        let value = sessionStorage.getItem(key);
        if (!value) {
          value = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : Date.now() + '-' + Math.random().toString(36).slice(2);
          sessionStorage.setItem(key, value);
        }
        return value;
      } catch (_) {
        return null;
      }
    };
    const clickDestination = (element) => {
      const raw = element && element.getAttribute ? element.getAttribute('href') || '' : '';
      if (!raw || raw.charAt(0) === '#') return raw.slice(0, 180) || null;
      try {
        const url = new URL(raw, location.href);
        return url.origin === location.origin
          ? (url.pathname + url.hash).slice(0, 300)
          : (url.origin + url.pathname).slice(0, 300);
      } catch (_) {
        return raw.slice(0, 300);
      }
    };
    const bindMobileNavClickTracking = () => {
      if (window.__hansoraMobileNavClickTrackingBound) return;
      window.__hansoraMobileNavClickTrackingBound = true;
      refreshAnalyticsAuthCache();
      window.addEventListener('storage', (event) => {
        if (/^sb-.*-auth-token$/.test(event.key || '')) refreshAnalyticsAuthCache();
      });

      document.addEventListener('click', (event) => {
        try {
          // The shared header tracker already records this click when present.
          if (window.__hansoraGlobalClickTrackingBound) return;
          const target = event.target && event.target.closest
            ? event.target.closest('.hs-bottom-nav a,.hs-bottom-nav button,.hs-radial a,.hs-radial button,.hs-overlay a,.hs-overlay button')
            : null;
          if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;

          const auth = readAnalyticsAuth();
          if (!auth || !auth.userId || !auth.accessToken) return;

          const label = String(
            target.getAttribute('aria-label') ||
            target.getAttribute('title') ||
            target.textContent ||
            target.id ||
            'unlabeled'
          ).replace(/\\s+/g, ' ').trim().slice(0, 180);

          fetch(SUPABASE_URL + '/rest/v1/click_events', {
            method: 'POST',
            keepalive: true,
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': 'Bearer ' + auth.accessToken,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              user_id: auth.userId,
              email: auth.email,
              event_name: 'click',
              element_type: String(target.tagName || '').toLowerCase() || null,
              element_id: String(target.id || '').slice(0, 180) || null,
              element_label: label || 'unlabeled',
              destination: clickDestination(target),
              page_path: (location.pathname + (location.hash || '')).slice(0, 300),
              session_id: analyticsSessionId(),
              device_type: 'mobile'
            })
          }).catch(() => {});
        } catch (_) {}
      }, true);
    };
    const getCurrentCredits = () => {
      try {
        if (window.HansoraHeader && typeof window.HansoraHeader.getCurrentCredits === 'function') {
          return Number(window.HansoraHeader.getCurrentCredits() || 0);
        }
        return Number(localStorage.getItem('hansora.header.credits') || 0);
      } catch (_) {
        return 0;
      }
    };
    const updateVideoLandingLinks = () => {
      const model = getCurrentCredits() < 4 ? 'grok-video' : 'kling-3';
      document.querySelectorAll('[data-hs-video-landing]').forEach((link) => {
        link.setAttribute('href', '/search-models.html?model=' + encodeURIComponent(model));
      });
    };
    const syncBottomNavToViewport = () => {
      if (!bottomNav) return;
      cancelAnimationFrame(bottomNavFrame);
      bottomNavFrame = requestAnimationFrame(() => {
        const viewportBottom = window.visualViewport
          ? window.visualViewport.offsetTop + window.visualViewport.height
          : window.innerHeight;
        const rect = bottomNav.getBoundingClientRect();
        const unshiftedBottom = rect.bottom - bottomNavShift;
        bottomNavShift = Math.max(0, Math.round(viewportBottom - unshiftedBottom));
        bottomNav.style.setProperty('--hs-viewport-shift', bottomNavShift + 'px');
      });
    };
    const lockPageScroll = () => {
      lockCount += 1;
      if (lockCount > 1) return;
      lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + lockedScrollY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    };
    const unlockPageScroll = () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount > 0) return;
      document.documentElement.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, lockedScrollY || 0);
    };
    const openMenu = (expandFeatures) => {
      if (!overlay) return;
      if (overlay.classList.contains('is-open')) {
        if (expandFeatures) overlay.classList.add('features-open');
        return;
      }
      lockPageScroll();
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      if (expandFeatures) overlay.classList.add('features-open');
    };
    const closeMenu = () => {
      if (!overlay) return;
      if (!overlay.classList.contains('is-open')) return;
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      unlockPageScroll();
    };
    const openRadial = () => {
      if (!radial) return;
      if (radial.classList.contains('is-open')) return;
      closeMenu();
      lockPageScroll();
      radial.classList.add('is-open');
      radial.setAttribute('aria-hidden', 'false');
    };
    const closeRadial = () => {
      if (!radial) return;
      if (!radial.classList.contains('is-open')) return;
      radial.classList.remove('is-open');
      radial.setAttribute('aria-hidden', 'true');
      unlockPageScroll();
    };
    menuBtn && menuBtn.addEventListener('click', () => { closeRadial(); openMenu(false); });
    closeBtn && closeBtn.addEventListener('click', closeMenu);
    backdrop && backdrop.addEventListener('click', closeMenu);
    modelsBtn && modelsBtn.addEventListener('click', openRadial);
    radialBackdrop && radialBackdrop.addEventListener('click', closeRadial);
    radialClose && radialClose.addEventListener('click', closeRadial);
    radialMore && radialMore.addEventListener('click', () => { closeRadial(); openMenu(true); });
    featureToggle && featureToggle.addEventListener('click', () => overlay && overlay.classList.toggle('features-open'));
    document.querySelectorAll('[data-hs-video-landing]').forEach((link) => {
      link.addEventListener('click', updateVideoLandingLinks);
    });
    bindMobileNavClickTracking();
    updateVideoLandingLinks();
    window.addEventListener('storage', (event) => {
      if (event.key === 'hansora.header.credits') updateVideoLandingLinks();
    });
    syncBottomNavToViewport();
    window.addEventListener('resize', syncBottomNavToViewport, { passive:true });
    window.addEventListener('orientationchange', syncBottomNavToViewport, { passive:true });
    window.visualViewport && window.visualViewport.addEventListener('resize', syncBottomNavToViewport, { passive:true });
    window.visualViewport && window.visualViewport.addEventListener('scroll', syncBottomNavToViewport, { passive:true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncBottomNavToViewport();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeRadial();
        closeMenu();
      }
    });
  })();
</script>`;

  let out = html.replace(/<\/body>/i, STYLE + NAV + '</body>');
  if (out === html) out = html + STYLE + NAV;
  return new Response(out, { status: res.status, headers: res.headers });
};
