// netlify/edge-functions/inject-bottom-nav-inline.js
// Injects the shared mobile bottom navigation into HTML responses.

export default async (request, context) => {
  const res = await context.next();
  const requestPath = new URL(request.url).pathname.toLowerCase();

  // Authentication, connector documentation and the full-screen video editor use focused standalone layouts.
  if (requestPath === '/oauth/consent' || requestPath === '/oauth/consent.html' || /^\/caption-studio(?:_(?:ru|arm))?(?:\.html)?\/?$/.test(requestPath) || /^\/automation(?:-[a-z]+)?(?:\.html)?(?:\/|$)/.test(requestPath)) {
    return res;
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const html = await res.text();

  if (html.includes('class="hs-bottom-nav"') || html.includes("class='hs-bottom-nav'")) {
    return new Response(html, { status: res.status, headers: res.headers });
  }

  const language = /_arm(?:\.html)?\/?$/.test(requestPath)
    ? 'arm'
    : /_ru(?:\.html)?\/?$/.test(requestPath)
      ? 'ru'
      : 'en';

  const COPY = {
    en: {
      mobileNav: 'Mobile bottom navigation',
      home: 'Home',
      features: 'Features',
      openCreate: 'Open create menu',
      create: 'Create',
      history: 'History',
      menu: 'Menu',
      chooseModel: 'Choose model type',
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      chatgptPlugin: 'ChatGPT Plugin',
      trend: 'Trend',
      more: 'See more',
      closeModels: 'Close models menu',
      closeMenu: 'Close menu',
      pricing: 'Pricing',
      faq: 'FAQ',
      contact: 'Contact',
      feedback: 'Feedback'
    },
    arm: {
      mobileNav: 'Բջջային ստորին նավիգացիա',
      home: 'Գլխավոր',
      features: 'Գործիքներ',
      openCreate: 'Բացել ստեղծման ընտրացանկը',
      create: 'Ստեղծել',
      history: 'Պատմություն',
      menu: 'Մենյու',
      chooseModel: 'Ընտրեք մոդելի տեսակը',
      image: 'Պատկեր',
      video: 'Տեսանյութ',
      audio: 'Ձայն',
      chatgptPlugin: 'ChatGPT Plugin',
      trend: 'Թրենդ',
      more: 'Տեսնել ավելին',
      closeModels: 'Փակել մոդելների ընտրացանկը',
      closeMenu: 'Փակել ընտրացանկը',
      pricing: 'Գներ',
      faq: 'Հաճախ տրվող հարցեր',
      contact: 'Կապ',
      feedback: 'Կարծիք հայտնել'
    },
    ru: {
      mobileNav: 'Нижняя мобильная навигация',
      home: 'Главная',
      features: 'Инструменты',
      openCreate: 'Открыть меню создания',
      create: 'Создать',
      history: 'История',
      menu: 'Меню',
      chooseModel: 'Выберите тип модели',
      image: 'Изображение',
      video: 'Видео',
      audio: 'Аудио',
      chatgptPlugin: 'ChatGPT Plugin',
      trend: 'Тренды',
      more: 'Смотреть ещё',
      closeModels: 'Закрыть меню моделей',
      closeMenu: 'Закрыть меню',
      pricing: 'Цены',
      faq: 'Частые вопросы',
      contact: 'Контакты',
      feedback: 'Обратная связь'
    }
  };
  const copy = COPY[language];
  // Highlight the tab for the page being viewed.
  const active = /^\/(?:index(?:_(?:ru|arm))?\.html)?$/.test(requestPath)
    ? 'home'
    : /^\/models(?:_(?:ru|arm))?\.html$/.test(requestPath)
      ? 'features'
      : /^\/usage(?:_(?:ru|arm))?\.html$/.test(requestPath)
        ? 'history'
        : '';
  const localizedPath = (value) => {
    if (language === 'en') return value;
    const match = value.match(/^([^?#]+)([?#].*)?$/);
    if (!match) return value;
    const path = match[1];
    const tail = match[2] || '';
    if (!path.endsWith('.html') || new RegExp(`_${language}\\.html$`).test(path)) {
      return value;
    }
    return path.replace(/\.html$/, `_${language}.html`) + tail;
  };

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
      /* iPhone Safari can draw the page under the home bar without reporting a safe area, so always keep a lift. */
      --hs-safe-bottom:max(env(safe-area-inset-bottom, 0px), 16px);
    }
    body{ padding-bottom:calc(var(--hs-bottom-height) + var(--hs-safe-bottom)); }
    /* Floating glass dock */
    .hs-bottom-nav{
      position:fixed;
      left:max(10px, env(safe-area-inset-left, 0px));
      right:max(10px, env(safe-area-inset-right, 0px));
      bottom:calc(10px + var(--hs-safe-bottom));
      z-index:60;
      display:block;
      box-sizing:border-box;
      isolation:isolate;
      max-width:520px;
      margin:0 auto;
      border-radius:26px;
      border:1px solid rgba(255,255,255,.09);
      background:rgba(12,14,21,.985);
      -webkit-backdrop-filter:blur(22px) saturate(170%);
      backdrop-filter:blur(22px) saturate(170%);
      box-shadow:0 18px 44px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.07);
      transform:translate3d(0,var(--hs-viewport-shift,0px),0);
      -webkit-transform:translate3d(0,var(--hs-viewport-shift,0px),0);
    }
    .hs-bottom-nav::before{
      content:"";
      position:absolute;
      inset:0;
      z-index:-1;
      border-radius:inherit;
      background:radial-gradient(120% 140% at 50% 0%, rgba(139,92,246,.10), transparent 60%);
      pointer-events:none;
    }
    .hs-bottom-rail{
      height:78px;
      display:grid;
      grid-template-columns:minmax(0,1fr) minmax(0,1fr) 66px minmax(0,1fr) minmax(0,1fr);
      align-items:center;
      padding:0 4px;
    }
    .hs-btn{
      position:relative;
      width:100%;
      min-width:0;
      height:70px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:6px;
      border:0;
      border-radius:18px;
      background:transparent;
      color:rgba(226,230,240,.58);
      font:600 11.5px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      letter-spacing:.01em;
      text-decoration:none;
      -webkit-tap-highlight-color:transparent;
      transition:color .2s ease, transform .15s ease;
    }
    html[lang="ru"] .hs-btn, html[lang="ru"] .hs-fab-label{ font-size:10.5px; letter-spacing:0; }
    html[lang="hy"] .hs-btn, html[lang="hy"] .hs-fab-label{ font-size:10px; letter-spacing:0; }
    .hs-btn span{ max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 2px; }
    .hs-btn:active{ transform:scale(.92); color:#fff; }
    .hs-btn.is-active{ color:#fff; }
    .hs-btn.is-active svg{ filter:drop-shadow(0 0 8px rgba(167,139,250,.7)); }
    .hs-btn.is-active::after{
      content:"";
      position:absolute;
      bottom:4px;
      left:50%;
      width:16px;
      height:3px;
      margin-left:-8px;
      border-radius:3px;
      background:linear-gradient(90deg,#a78bfa,#38bdf8);
    }
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
    .hs-btn svg{ width:24px; height:24px; stroke-width:1.9; }
    .hs-fab-wrap{ display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; }
    .hs-fab{
      position:relative;
      width:58px;
      height:58px;
      margin-top:-30px;
      display:grid;
      place-items:center;
      padding:0;
      border-radius:50%;
      border:0;
      background:conic-gradient(from 210deg,#8b5cf6,#6366f1,#38bdf8,#8b5cf6);
      box-shadow:0 0 0 5px rgba(14,16,24,.92), 0 12px 28px rgba(99,102,241,.55), 0 4px 14px rgba(56,189,248,.35);
      color:#fff;
      -webkit-tap-highlight-color:transparent;
      transition:transform .15s ease;
    }
    .hs-fab::before{
      content:"";
      position:absolute;
      inset:2px;
      border-radius:50%;
      background:linear-gradient(160deg,rgba(255,255,255,.28),rgba(255,255,255,0) 55%);
      pointer-events:none;
    }
    .hs-fab:active{ transform:scale(.92); }
    .hs-fab svg.hs-fab-plus{ width:26px; height:26px; stroke:#fff; stroke-width:2.6; fill:none; stroke-linecap:round; position:relative; }
    .hs-fab-label{
      margin-top:7px;
      color:#fff;
      font:700 11.5px/1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      letter-spacing:.01em;
      max-width:72px;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
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
      background:radial-gradient(120% 70% at 50% 100%, rgba(76,29,149,.38), rgba(3,4,10,.62) 70%);
      -webkit-backdrop-filter:blur(6px);
      backdrop-filter:blur(6px);
      opacity:0;
      transition:opacity .25s ease;
    }
    .hs-radial.is-open .hs-radial-backdrop{ opacity:1; }
    .hs-radial-panel{
      position:absolute;
      left:50%;
      bottom:0;
      width:min(112vw,520px);
      height:262px;
      transform:translateX(-50%) translateY(40px) scale(.94);
      transform-origin:bottom center;
      border-radius:999px 999px 0 0 / 360px 360px 0 0;
      border:1px solid rgba(255,255,255,.10);
      border-bottom:0;
      background:
        radial-gradient(60% 55% at 50% 0%, rgba(139,92,246,.22), transparent 70%),
        radial-gradient(45% 45% at 50% 100%, rgba(56,189,248,.14), transparent 70%),
        linear-gradient(180deg, rgba(24,22,38,.97), rgba(10,11,18,.99));
      box-shadow:0 -24px 90px rgba(109,40,217,.28), 0 -2px 0 rgba(255,255,255,.04) inset, 0 1px 0 rgba(255,255,255,.10) inset;
      -webkit-backdrop-filter:blur(22px) saturate(160%);
      backdrop-filter:blur(22px) saturate(160%);
      opacity:0;
      transition:opacity .25s ease, transform .32s cubic-bezier(.2,.9,.25,1.15);
    }
    .hs-radial-panel::before{
      content:"";
      position:absolute;
      inset:-1px -1px 0;
      border-radius:inherit;
      padding:1px 1px 0;
      background:linear-gradient(90deg, rgba(56,189,248,.0), rgba(167,139,250,.75) 30%, rgba(244,114,182,.6) 70%, rgba(56,189,248,0));
      -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite:xor;
      mask-composite:exclude;
      pointer-events:none;
    }
    .hs-radial.is-open .hs-radial-panel{
      opacity:1;
      transform:translateX(-50%) translateY(0) scale(1);
    }
    .hs-radial-item{
      position:absolute;
      width:96px;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:8px;
      border:0;
      background:transparent;
      color:#eef0f7;
      text-decoration:none;
      transform:translate(-50%,-50%);
      font:750 12.5px/1.1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      letter-spacing:.01em;
      -webkit-tap-highlight-color:transparent;
    }
    .hs-radial-item b{ font-weight:750; text-align:center; text-shadow:0 1px 8px rgba(0,0,0,.5); }
    html[lang="hy"] .hs-radial-item b{ max-width:84px; }
    html:has(.hs-radial.is-open) .hsa-launcher{ opacity:0; pointer-events:none; }
    .hs-radial-icon{
      position:relative;
      width:54px;
      height:54px;
      display:grid;
      place-items:center;
      border-radius:18px;
      background:linear-gradient(145deg, var(--hs-c1,#8b5cf6), var(--hs-c2,#38bdf8));
      color:#fff;
      box-shadow:0 10px 26px -8px var(--hs-glow,rgba(139,92,246,.7)), inset 0 1px 0 rgba(255,255,255,.35), inset 0 -8px 16px rgba(0,0,0,.18);
      opacity:0;
      transform:translateY(16px) scale(.7);
      transition:transform .18s ease, opacity .18s ease;
    }
    .hs-radial-icon::after{
      content:"";
      position:absolute;
      inset:1px;
      border-radius:17px;
      background:linear-gradient(180deg, rgba(255,255,255,.22), transparent 45%);
      pointer-events:none;
    }
    .hs-radial-icon svg{ width:25px; height:25px; stroke-width:2.1; filter:drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
    .hs-radial.is-open .hs-radial-icon{ animation:hs-radial-pop .42s cubic-bezier(.2,.9,.3,1.3) forwards; }
    .hs-radial.is-open .hs-radial-video .hs-radial-icon{ animation-delay:.03s; }
    .hs-radial.is-open .hs-radial-image .hs-radial-icon,
    .hs-radial.is-open .hs-radial-audio .hs-radial-icon{ animation-delay:.08s; }
    .hs-radial.is-open .hs-radial-trend .hs-radial-icon,
    .hs-radial.is-open .hs-radial-more .hs-radial-icon{ animation-delay:.13s; }
    @keyframes hs-radial-pop{ to{ opacity:1; transform:none; } }
    .hs-radial-item:active .hs-radial-icon{ transform:scale(.92); }
    .hs-radial-image{ left:28%; top:38%; --hs-c1:#38bdf8; --hs-c2:#6366f1; --hs-glow:rgba(56,189,248,.65); }
    .hs-radial-video{ left:50%; top:23%; --hs-c1:#a78bfa; --hs-c2:#7c3aed; --hs-glow:rgba(139,92,246,.75); }
    .hs-radial-audio{ left:72%; top:38%; --hs-c1:#f472b6; --hs-c2:#c026d3; --hs-glow:rgba(236,72,153,.6); }
    .hs-radial-trend{ left:16%; top:70%; --hs-c1:#d9ff3d; --hs-c2:#22c55e; --hs-glow:rgba(163,230,53,.5); }
    .hs-radial-trend .hs-radial-icon{ color:#0b1203; }
    .hs-radial-more{ left:84%; top:70%; --hs-c1:#fbbf24; --hs-c2:#f97316; --hs-glow:rgba(251,146,60,.55); }
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
      background:
        linear-gradient(rgba(16,17,26,.92), rgba(16,17,26,.92)) padding-box,
        conic-gradient(from 210deg, #38bdf8, #8b5cf6, #ec4899, #f59e0b, #38bdf8) border-box;
      border:2px solid transparent;
      color:#fff;
      box-shadow:0 10px 30px rgba(109,40,217,.45);
      transition:transform .3s cubic-bezier(.2,.9,.3,1.2);
      -webkit-tap-highlight-color:transparent;
    }
    .hs-radial.is-open .hs-radial-close{ transform:translateX(-50%) rotate(90deg); }
    .hs-radial-close:active{ transform:translateX(-50%) rotate(90deg) scale(.92); }
    .hs-radial-close svg{ width:26px; height:26px; stroke-width:2.6; }
    @media (prefers-reduced-motion:reduce){
      .hs-radial-panel, .hs-radial-close, .hs-radial-backdrop{ transition:none; }
      .hs-radial.is-open .hs-radial-icon{ animation:none; opacity:1; transform:none; }
    }
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
    .hs-top-badge{
      margin-left:auto;
      display:inline-flex;
      align-items:center;
      height:20px;
      padding:0 8px;
      border-radius:7px;
      background:linear-gradient(135deg,#d9ff3d,#a3f05a);
      color:#0b1203;
      font:900 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
      letter-spacing:.02em;
      box-shadow:0 0 14px rgba(201,255,61,.3);
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

  const NAV = `<nav aria-label="${copy.mobileNav}" class="hs-bottom-nav">
  <div class="hs-bottom-rail">
    <a aria-label="${copy.home}" class="hs-btn${active === 'home' ? ' is-active' : ''}"${active === 'home' ? ' aria-current="page"' : ''} href="${localizedPath('/index.html')}">
      <svg viewBox="0 0 24 24"><path d="M3 10.5L12 3l9 7.5"></path><path d="M5 9.5V21h14V9.5"></path></svg>
      <span>${copy.home}</span>
    </a>
    <a aria-label="${copy.features}" class="hs-btn${active === 'features' ? ' is-active' : ''}"${active === 'features' ? ' aria-current="page"' : ''} href="${localizedPath('/models.html#featuresSection')}">
      <svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"></path></svg>
      <span>${copy.features}</span>
    </a>
    <div class="hs-fab-wrap">
      <button aria-label="${copy.openCreate}" class="hs-fab" id="hs-models-btn" type="button">
        <svg aria-hidden="true" class="hs-fab-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>
      </button>
      <span aria-hidden="true" class="hs-fab-label">${copy.create}</span>
    </div>
    <a aria-label="${copy.history}" class="hs-btn${active === 'history' ? ' is-active' : ''}"${active === 'history' ? ' aria-current="page"' : ''} href="${localizedPath('/usage.html')}">
      <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.708"></path><path d="M3 3v6h6"></path><path d="M12 7v6l4 2"></path></svg>
      <span>${copy.history}</span>
    </a>
    <button aria-label="${copy.menu}" class="hs-btn" id="hs-menu-btn" type="button">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
      <span>${copy.menu}</span>
    </button>
  </div>
</nav>

<div class="hs-radial" id="hs-radial" aria-hidden="true">
  <div class="hs-radial-backdrop" id="hs-radial-backdrop"></div>
  <div class="hs-radial-panel" role="dialog" aria-modal="true" aria-label="${copy.chooseModel}">
    <a class="hs-radial-item hs-radial-image" href="${localizedPath('/search-models.html')}">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path><circle cx="8" cy="8" r="1.5"></circle></svg></span>
      <b>${copy.image}</b>
    </a>
    <a class="hs-radial-item hs-radial-video" data-hs-video-landing href="${localizedPath('/search-models.html?model=gemini-omni-flash-1-1')}">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg></span>
      <b>${copy.video}</b>
    </a>
    <a class="hs-radial-item hs-radial-audio" href="${localizedPath('/audio.html')}">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path><path d="M21 11v2"></path></svg></span>
      <b>${copy.audio}</b>
    </a>
    <a class="hs-radial-item hs-radial-trend" href="${localizedPath('/examples.html')}">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M4 17l5-5 4 3 7-8"></path><path d="M15 7h5v5"></path></svg></span>
      <b>${copy.trend}</b>
    </a>
    <a class="hs-radial-item hs-radial-more" href="${localizedPath('/models.html')}">
      <span class="hs-radial-icon"><svg viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"></path><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"></path></svg></span>
      <b>${copy.more}</b>
    </a>
    <button class="hs-radial-close" id="hs-radial-close" type="button" aria-label="${copy.closeModels}">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
  </div>
</div>

<div class="hs-overlay" id="hs-overlay" aria-hidden="true">
  <div class="backdrop" id="hs-backdrop"></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="hs-ol-title">
    <header>
      <h3 id="hs-ol-title">${copy.menu}</h3>
      <button id="hs-close" aria-label="${copy.closeMenu}" type="button">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </header>
    <div class="links">
      <a href="${localizedPath('/search-models.html')}"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 13l2.5-3 3 4 2-2.5L20 17"></path></svg> ${copy.image}</a>
      <a data-hs-video-landing href="${localizedPath('/search-models.html?model=gemini-omni-flash-1-1')}"><svg viewBox="0 0 24 24"><path d="M4 6h11v12H4z"></path><path d="M15 10l5-3v10l-5-3"></path></svg> ${copy.video}</a>
      <a href="${localizedPath('/audio.html')}"><svg viewBox="0 0 24 24"><path d="M5 10v4"></path><path d="M9 7v10"></path><path d="M13 5v14"></path><path d="M17 8v8"></path></svg> ${copy.audio}</a>
      <a href="${localizedPath('/henshin.html')}"><svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.5"></circle><path d="M3.5 20c1.1-3.6 3.6-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.5"></path><path d="M18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13z"></path></svg> Henshin<span class="hs-top-badge">Top</span></a>
      <a href="${localizedPath('/mcp-setup.html')}"><svg viewBox="0 0 24 24"><path d="M9 2v5M15 2v5"></path><path d="M6 7h12v4a6 6 0 0 1-12 0z"></path><path d="M12 17v5"></path></svg> ${copy.chatgptPlugin}</a>
      <button class="hs-feature-toggle" id="hs-feature-toggle" type="button">
        <span><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"></path></svg> ${copy.features}</span>
        <svg class="hs-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
      </button>
      <div class="hs-feature-list" id="hs-feature-list">
        <a href="${localizedPath('/upscale.html')}">Image upscale</a>
        <a href="${localizedPath('/expand.html?mode=angles')}">Full angles</a>
        <a href="${localizedPath('/expand.html?mode=expand')}">Expand</a>
        <a href="${localizedPath('/character.html')}">Character</a>
        <a href="${localizedPath('/product_card.html')}">Product Card</a>
        <a href="${localizedPath('/prompt-builder.html')}">Cartoon Prompt Builder</a>
        <a href="${localizedPath('/kid-cartoon.html')}">Kid Cartoon</a>
        <a href="${localizedPath('/henshin.html')}">Henshin</a>
        <a href="${localizedPath('/video-edit.html')}">Video Edit</a>
        <a href="${localizedPath('/background-change.html')}">Background Change</a>
        <a href="${localizedPath('/video-relight.html')}">Video Relight</a>
        <a href="${localizedPath('/upscale.html?mode=video')}">Video upscale</a>
        <a href="${localizedPath('/lipsync.html')}">Lipsync Avatar</a>
        <a href="${localizedPath('/audio.html?tool=text-to-speech')}">Text to speech</a>
        <a href="${localizedPath('/audio.html?tool=voice-isolater')}">Voice isolater</a>
        <a href="${localizedPath('/audio.html?tool=voice-changer')}">Voice changer</a>
        <a href="${localizedPath('/audio.html?tool=song-creation')}">Song Creation</a>
        <a href="${localizedPath('/analyse.html')}">Hook analyse</a>
        <a href="${localizedPath('/models.html')}">${copy.more}</a>
      </div>
      <a href="${localizedPath('/pricing.html')}"><svg viewBox="0 0 24 24"><path d="M3 7h18v10H3z"></path><path d="M8 10h8M8 14h8"></path></svg> ${copy.pricing}</a>
      <a href="${localizedPath('/index.html#faq')}"><svg viewBox="0 0 24 24"><path d="M12 17h.01"></path><path d="M9.09 9a3 3 0 1 1 5.91 1c0 2-3 2-3 4"></path></svg> ${copy.faq}</a>
      <a href="${localizedPath('/contact.html')}"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path><path d="M4 8l8 6 8-6"></path></svg> ${copy.contact}</a>
      <button class="hs-feature-toggle" id="hs-feedback-btn" data-hansora-feedback type="button" aria-haspopup="dialog"><span><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"></path><path d="M7 10h8M7 14h5"></path></svg> ${copy.feedback}</span></button>
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
    const localizedSearchModelsPath = ${JSON.stringify(localizedPath('/search-models.html'))};
    const updateVideoLandingLinks = () => {
      const model = getCurrentCredits() < 4 ? 'grok-video' : 'gemini-omni-flash-1-1';
      document.querySelectorAll('[data-hs-video-landing]').forEach((link) => {
        link.setAttribute('href', localizedSearchModelsPath + '?model=' + encodeURIComponent(model));
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
        // Keep the dock's floating gap above the screen edge instead of pinning it flush to the bottom.
        const dockGap = parseFloat(getComputedStyle(bottomNav).bottom) || 0;
        bottomNavShift = Math.max(0, Math.round(viewportBottom - dockGap - unshiftedBottom));
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
    document.getElementById('hs-feedback-btn')?.addEventListener('click', closeMenu);
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
</script>
<script id="hansoraFeedbackScript" src="/feedback.js?v=1" defer></script>`;

  let out = html.replace(/<\/body>/i, STYLE + NAV + '</body>');
  if (out === html) out = html + STYLE + NAV;
  return new Response(out, { status: res.status, headers: res.headers });
};
