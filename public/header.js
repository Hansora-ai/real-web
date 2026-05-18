(function () {
  'use strict';

  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const LOGO_URL = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/downloads/2025/ChatGPT%20Image%20Oct%2020,%202025,%2011_50_37%20AM.png';
  const CACHE_PREFIX = 'hansora.header.';

  let sb = null;
  let currentUser = null;
  let currentCredits = 0;

  const IMAGE_MENU_MODELS = [
    { label: 'GPT Image 2', id: 'gpt-image-2', icon: 'G2', note: 'Latest image generation' },
    { label: 'Nano Banana 2', id: 'nano-banana-2', icon: 'N2', note: 'Fast image edits' },
    { label: 'Seedream 5.0 Lite', id: 'seedream-5-lite', icon: 'S', note: 'Light creative images' },
    { label: 'Grok Image', id: 'grok-image', icon: 'X', note: 'Stylized image model' },
    { label: 'Seedream 4.5', id: 'seedream-4-5', icon: 'S4', note: 'Image generator' },
    { label: 'Wan 2.7', id: 'wan-2-7', icon: 'W', note: 'Image and frame work' },
    { label: 'Qwen 2', id: 'qwen-2', icon: 'Q2', note: 'Image generation' },
    { label: 'Z Image', id: 'z-image', icon: 'Z', note: 'Creative image model' },
    { label: 'GPT Image 1.5', id: 'gpt-image-1-5', icon: 'G1', note: 'OpenAI image model' },
    { label: 'Nano Banana', id: 'nano-banana', icon: 'NB', note: 'Image editing' },
  ];

  const IMAGE_MENU_TOOLS = [
    { label: 'Upscale', href: '/upscale.html', icon: 'UP', note: 'Increase image quality' },
    { label: 'Full angles', href: '/expand.html?mode=angles', icon: 'FA', note: 'Different angles chosen' },
    { label: 'Expand', href: '/expand.html?mode=expand', icon: 'EX', note: 'Extend image edges' },
    { label: 'Face swap', href: '/expand.html?mode=face-swap', icon: 'FS', note: 'Chosen face swap' },
    { label: 'Character', href: '/character.html', icon: 'CH', note: 'Character creator' },
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function ensureSupabaseClient() {
    if (window.__HANSORA_SB__) {
      sb = window.__HANSORA_SB__;
      return sb;
    }
    if (!window.supabase || !window.supabase.createClient) {
      console.error('Supabase library not loaded; cannot initialize Hansora header.');
      return null;
    }
    window.__HANSORA_SB__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb = window.__HANSORA_SB__;
    window.hansoraSupabase = sb;
    return sb;
  }

  function readCache(key, fallback = '') {
    try {
      const value = localStorage.getItem(CACHE_PREFIX + key);
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeCache(key, value) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, String(value));
    } catch (_) {}
  }

  function clearCache() {
    try {
      ['loggedIn', 'credits', 'avatar'].forEach((key) => localStorage.removeItem(CACHE_PREFIX + key));
    } catch (_) {}
  }

  function formatCredits(value) {
    const n = Number(value || 0);
    return `${Number.isInteger(n) ? n : n.toFixed(2)}⚡`;
  }

  function modelHref(id) {
    return `/search-models.html?model=${encodeURIComponent(id)}`;
  }

  function menuIconClass(index) {
    return index % 4 === 0 ? 'blue' : index % 4 === 1 ? 'violet' : index % 4 === 2 ? 'lime' : 'pink';
  }

  function renderImageMegaMenu() {
    const modelItems = IMAGE_MENU_MODELS.map((item, index) => `
      <a class="hansora-mega-item" href="${modelHref(item.id)}" data-hansora-model="${item.id}">
        <span class="hansora-mega-icon ${menuIconClass(index)}">${item.icon}</span>
        <span>
          <strong>${item.label}</strong>
          <em>${item.note}</em>
        </span>
      </a>`).join('');
    const toolItems = IMAGE_MENU_TOOLS.map((item, index) => `
      <a class="hansora-mega-item" href="${item.href}">
        <span class="hansora-mega-icon ${menuIconClass(index + 2)}">${item.icon}</span>
        <span>
          <strong>${item.label}</strong>
          <em>${item.note}</em>
        </span>
      </a>`).join('');
    return `
      <div class="hansora-mega-menu" id="hansoraImageMega" role="menu" aria-label="Image tools and models">
        <section>
          <div class="hansora-mega-eyebrow">Image models</div>
          <div class="hansora-mega-grid">${modelItems}</div>
        </section>
        <section>
          <div class="hansora-mega-eyebrow">Image tools</div>
          <div class="hansora-mega-grid">${toolItems}</div>
        </section>
      </div>`;
  }

  function injectHeaderStyles() {
    if (document.getElementById('hansoraHeaderMegaStyles')) return;
    const style = document.createElement('style');
    style.id = 'hansoraHeaderMegaStyles';
    style.textContent = `
      .nav-links .hansora-nav-item{ position:relative; display:inline-flex; align-items:center; }
      .nav-links .hansora-nav-trigger{ display:inline-flex; align-items:center; gap:8px; text-decoration:none; color:inherit; }
      .nav-links .hansora-nav-trigger::after{ content:""; width:6px; height:6px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(45deg); opacity:.55; margin-top:-3px; transition:transform .18s ease, opacity .18s ease; }
      .nav-links .hansora-nav-item:hover .hansora-nav-trigger::after,
      .nav-links .hansora-nav-item:focus-within .hansora-nav-trigger::after{ transform:rotate(225deg); margin-top:3px; opacity:.9; }
      .hansora-mega-menu{
        position:absolute;
        top:calc(100% + 18px);
        left:50%;
        width:min(760px,calc(100vw - 28px));
        transform:translateX(-26%) translateY(8px);
        display:grid;
        grid-template-columns:1.1fr .9fr;
        gap:18px;
        padding:18px;
        border:1px solid rgba(255,255,255,.10);
        border-radius:24px;
        background:linear-gradient(145deg,rgba(22,24,31,.98),rgba(10,12,18,.98));
        box-shadow:0 26px 80px rgba(0,0,0,.46), inset 0 1px 0 rgba(255,255,255,.08);
        backdrop-filter:blur(22px);
        opacity:0;
        visibility:hidden;
        pointer-events:none;
        transition:opacity .18s ease, transform .18s ease, visibility .18s ease;
        z-index:1000;
      }
      .hansora-mega-menu::before{ content:""; position:absolute; left:0; right:0; top:-22px; height:22px; }
      .nav-links .hansora-nav-item:hover .hansora-mega-menu,
      .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{
        opacity:1;
        visibility:visible;
        pointer-events:auto;
        transform:translateX(-26%) translateY(0);
      }
      .hansora-mega-eyebrow{
        margin:0 0 10px;
        color:rgba(255,255,255,.48);
        font-size:11px;
        font-weight:850;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .hansora-mega-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
      .hansora-mega-item{
        display:flex;
        align-items:center;
        gap:12px;
        min-height:64px;
        padding:10px;
        border:1px solid rgba(255,255,255,.08);
        border-radius:16px;
        background:rgba(255,255,255,.035);
        color:#fff;
        text-decoration:none;
        transition:transform .16s ease, border-color .16s ease, background .16s ease;
      }
      .hansora-mega-item:hover,
      .hansora-mega-item:focus-visible{
        transform:translateY(-1px);
        border-color:rgba(125,211,252,.42);
        background:rgba(125,211,252,.08);
        outline:none;
      }
      .hansora-mega-icon{
        width:42px;
        height:42px;
        flex:0 0 42px;
        display:grid;
        place-items:center;
        border-radius:13px;
        color:#071018;
        font-size:13px;
        font-weight:950;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.65), 0 12px 26px rgba(0,0,0,.22);
      }
      .hansora-mega-icon.blue{ background:linear-gradient(135deg,#dbeafe,#7dd3fc); }
      .hansora-mega-icon.violet{ background:linear-gradient(135deg,#fde68a,#a78bfa,#f472b6); }
      .hansora-mega-icon.lime{ background:linear-gradient(135deg,#ecfccb,#bef264); }
      .hansora-mega-icon.pink{ background:linear-gradient(135deg,#67e8f9,#c084fc,#f472b6); }
      .hansora-mega-item strong{ display:block; color:rgba(255,255,255,.94); font-size:13px; line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .hansora-mega-item em{ display:block; margin-top:4px; color:rgba(255,255,255,.48); font-size:11px; font-style:normal; line-height:1.25; }
      @media (max-width:900px){
        .hansora-mega-menu{ left:0; transform:translateX(-16px) translateY(8px); grid-template-columns:1fr; width:min(92vw,520px); max-height:72vh; overflow:auto; }
        .nav-links .hansora-nav-item:hover .hansora-mega-menu,
        .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{ transform:translateX(-16px) translateY(0); }
      }
      @media (max-width:560px){ .hansora-mega-grid{ grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function injectHeader() {
    const mount = document.getElementById('sharedHeader');
    if (!mount || mount.dataset.hansoraHeaderMounted === '1') return;
    mount.dataset.hansoraHeaderMounted = '1';
    const cachedLoggedIn = readCache('loggedIn') === '1';
    const cachedCredits = readCache('credits', '0');
    const cachedAvatar = readCache('avatar', 'https://ui-avatars.com/api/?name=H&background=6366f1&color=fff');
    mount.innerHTML = `
      <header class="site-header" id="siteHeader">
        <div class="shell nav">
          <a class="brand" href="/" aria-label="HANSORA AI home">
            <img src="${LOGO_URL}" alt="">
            <span>HANSORA AI</span>
          </a>
          <nav class="nav-links" aria-label="Primary navigation">
            <span class="hansora-nav-item">
              <a class="hansora-nav-trigger" href="/search-models.html">Image</a>
              ${renderImageMegaMenu()}
            </span>
            <a href="/search-models.html">Video</a>
            <a href="/models.html">Features</a>
            <a href="/pricing.html">Pricing</a>
            <a href="/examples-prompts.html">Examples/Prompts</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div class="nav-actions">
            <button class="btn btn-ghost" type="button" id="btnLoginSignup" style="display:${cachedLoggedIn ? 'none' : 'inline-flex'}">Login</button>
            <span class="credits-pill" id="navCredits" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">${formatCredits(cachedCredits)}</span>
            <button class="avatar-button" type="button" id="navAvatar" aria-label="Open account menu" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">
              <img id="navAvatarImg" alt="" src="${cachedAvatar}">
            </button>
            <a class="btn btn-primary" href="/search-models.html" id="btnGetStarted">Start creating</a>
          </div>
        </div>
        <div class="user-menu" id="navMenu">
          <a href="/profile.html">Profile</a>
          <a href="/usage.html">History</a>
          <a href="/pricing.html">Credits</a>
          <button type="button" id="btnLogout">Logout</button>
        </div>
      </header>`;
  }

  function injectAuthModal() {
    if (document.getElementById('authModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="hansora-auth-modal" id="authModal" aria-hidden="true">
        <div class="hansora-auth-card" id="authCard" role="dialog" aria-modal="true" aria-labelledby="authTitle">
          <div class="hansora-auth-head">
            <h3 id="authTitle">Log in</h3>
            <button class="btn hansora-auth-close" id="authClose" type="button">✕</button>
          </div>
          <form class="hansora-auth-form" id="authForm">
            <button class="btn hansora-google-btn" id="btnGoogleLogin" type="button">
              <img alt="G" src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg">
              <span>Log in with Google</span>
            </button>
            <div class="hansora-auth-divider"><span>or</span></div>
            <input id="authEmail" placeholder="Email" required type="email" autocomplete="email">
            <input id="authPass" placeholder="Password" required type="password" autocomplete="current-password">
            <div class="hansora-auth-actions">
              <button class="btn btn-brand" id="btnDoLogin" type="button">Log in</button>
              <a class="btn" id="btnGoSignup" href="/login.html?mode=signup">Sign up</a>
            </div>
            <p class="hansora-auth-msg" id="authMsg"></p>
          </form>
        </div>
      </div>`);
  }

  function el(id) { return document.getElementById(id); }

  function setCreditsDisplay(value) {
    const n = Number(value || 0);
    currentCredits = n;
    writeCache('credits', n);
    const navCredits = el('navCredits');
    if (navCredits) navCredits.textContent = formatCredits(n);
  }

  function avatarUrlFor(user) {
    const email = user && user.email ? user.email : 'Hansora';
    const metadata = user && user.user_metadata ? user.user_metadata : {};
    return metadata.avatar_url || metadata.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(email.slice(0, 1).toUpperCase())}&background=6366f1&color=fff`;
  }

  function showLoggedInUI(profile, user) {
    currentUser = user || null;
    const header = el('siteHeader');
    const loginBtn = el('btnLoginSignup');
    const navCredits = el('navCredits');
    const navAvatar = el('navAvatar');
    const navAvatarImg = el('navAvatarImg');
    if (header) header.classList.remove('auth-checking');
    if (loginBtn) loginBtn.style.display = 'none';
    if (navCredits) navCredits.style.display = 'inline-flex';
    if (navAvatar) navAvatar.style.display = 'inline-flex';
    if (navAvatarImg && user) {
      navAvatarImg.src = avatarUrlFor(user);
      writeCache('avatar', navAvatarImg.src);
    }
    writeCache('loggedIn', '1');
    setCreditsDisplay(profile && profile.credits != null ? profile.credits : 0);
  }

  function showLoggedOutUI() {
    currentUser = null;
    currentCredits = 0;
    const header = el('siteHeader');
    const loginBtn = el('btnLoginSignup');
    const navCredits = el('navCredits');
    const navAvatar = el('navAvatar');
    const navMenu = el('navMenu');
    if (header) header.classList.remove('auth-checking');
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (navCredits) navCredits.style.display = 'none';
    if (navAvatar) navAvatar.style.display = 'none';
    if (navMenu) navMenu.classList.remove('is-open');
    clearCache();
  }

  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = 'login';
    const title = el('authTitle');
    const msg = el('authMsg');
    if (title) title.textContent = 'Log in';
    if (msg) msg.textContent = '';
  }

  function openAuth(mode) {
    if (mode) setAuthMode(mode);
    const modal = el('authModal');
    const msg = el('authMsg');
    if (msg) msg.textContent = '';
    if (modal) {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeAuth() {
    const modal = el('authModal');
    const msg = el('authMsg');
    if (msg) msg.textContent = '';
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  async function getOrCreateProfile(user) {
    if (!sb || !user) throw new Error('Not logged in');
    const { data, error } = await sb
      .from('profiles')
      .select('user_id,email,credits')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const ins = await sb.from('profiles').insert({
        user_id: user.id,
        email: user.email,
        credits: 3
      }).select('user_id,email,credits').single();
      if (ins.error) throw ins.error;
      return ins.data;
    }
    return data;
  }

  async function getUserId() {
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  async function refreshCredits() {
    if (!sb) return currentCredits;
    const { data } = await sb.auth.getUser();
    const user = data && data.user ? data.user : null;
    if (!user) {
      showLoggedOutUI();
      return 0;
    }
    const { data: prof, error } = await sb
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    const next = prof && prof.credits != null ? prof.credits : 0;
    setCreditsDisplay(next);
    return next;
  }

  async function setCredits(value) {
    const uid = await getUserId();
    if (!uid) throw new Error('Not logged in');
    const { error } = await sb
      .from('profiles')
      .update({ credits: value })
      .eq('user_id', uid);
    if (error) throw error;
    setCreditsDisplay(value);
    return value;
  }

  async function addCredits(delta) {
    const current = await refreshCredits();
    const next = Number(current || 0) + Number(delta || 0);
    await setCredits(next);
    return next;
  }

  async function useCredits(cost) {
    const current = await refreshCredits();
    const amount = Number(cost || 0);
    if (Number(current || 0) < amount) throw new Error('Not enough credits');
    const next = Number(current || 0) - amount;
    await setCredits(next);
    return next;
  }

  function startCreditsPolling(durationMs = 180000, intervalMs = 2000) {
    if (window.__creditsPoll) clearInterval(window.__creditsPoll);
    const started = Date.now();
    window.__creditsPoll = setInterval(async function () {
      try { await refreshCredits(); } catch (error) { console.warn('credits poll read failed', error); }
      if (Date.now() - started > durationMs) clearInterval(window.__creditsPoll);
    }, intervalMs);
  }

  function bindEvents() {
    const navAvatar = el('navAvatar');
    const navMenu = el('navMenu');
    const btnLoginSignup = el('btnLoginSignup');
    const btnGetStarted = el('btnGetStarted');
    const btnLogout = el('btnLogout');
    const authClose = el('authClose');
    const doLogin = el('btnDoLogin');
    const btnGoogleLogin = el('btnGoogleLogin');
    const modal = el('authModal');

    document.querySelectorAll('[data-hansora-model]').forEach(function (link) {
      link.addEventListener('click', function () {
        try {
          localStorage.setItem('hansora.search.selectedModel', link.getAttribute('data-hansora-model') || '');
        } catch (_) {}
      });
    });

    if (navAvatar && navMenu) {
      navAvatar.addEventListener('click', function (event) {
        event.stopPropagation();
        navMenu.classList.toggle('is-open');
      });
      document.addEventListener('click', function (event) {
        if (!navMenu.contains(event.target) && !navAvatar.contains(event.target)) navMenu.classList.remove('is-open');
      });
    }

    if (btnLoginSignup) btnLoginSignup.addEventListener('click', function (event) { event.preventDefault(); openAuth('login'); });
    if (btnGetStarted) {
      btnGetStarted.addEventListener('click', function (event) {
        if (!currentUser) {
          event.preventDefault();
          window.location.href = '/login.html?mode=signup';
        }
      });
    }
    if (authClose) authClose.addEventListener('click', closeAuth);
    if (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === modal) closeAuth();
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeAuth();
    });

    if (btnGoogleLogin) {
      btnGoogleLogin.addEventListener('click', async function () {
        const msg = el('authMsg');
        if (msg) msg.textContent = 'Opening Google login…';
        try {
          const { error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${location.origin}/index.html` }
          });
          if (error && msg) msg.textContent = error.message || 'Google login failed.';
        } catch (error) {
          if (msg) msg.textContent = error.message || 'Google login failed.';
        }
      });
    }

    if (doLogin) {
      doLogin.addEventListener('click', async function () {
        const emailIn = el('authEmail');
        const passIn = el('authPass');
        const msg = el('authMsg');
        if (!emailIn.value || !passIn.value) { if (msg) msg.textContent = 'Enter email & password.'; return; }
        if (msg) msg.textContent = 'Signing in…';
        try {
          const { data, error } = await sb.auth.signInWithPassword({ email: emailIn.value.trim(), password: passIn.value.trim() });
          if (error) { if (msg) msg.textContent = error.message; return; }
          const profile = await getOrCreateProfile(data.user);
          showLoggedInUI(profile, data.user);
          closeAuth();
        } catch (error) {
          if (msg) msg.textContent = error.message || 'Login failed.';
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        if (sb) await sb.auth.signOut();
        showLoggedOutUI();
      });
    }
  }

  async function restoreSession() {
    if (!sb) {
      showLoggedOutUI();
      return;
    }
    try {
      const { data } = await sb.auth.getUser();
      const user = data && data.user ? data.user : null;
      if (!user) {
        showLoggedOutUI();
        return;
      }
      const profile = await getOrCreateProfile(user);
      showLoggedInUI(profile, user);
    } catch (error) {
      console.warn('Hansora header session restore failed', error);
      showLoggedOutUI();
    }
  }

  function exposeApi() {
    window.HansoraHeader = {
      refreshCredits,
      setCredits: setCreditsDisplay,
      saveCredits: setCredits,
      addCredits,
      useCredits,
      getCurrentUser: function () { return currentUser; },
      getCurrentCredits: function () { return currentCredits; },
      openAuth,
      closeAuth,
      startCreditsPolling
    };
    window.refreshCredits = refreshCredits;
    window.hansoraCredits = { addCredits, useCredits, setCredits };
  }

  ready(function () {
    injectHeaderStyles();
    injectHeader();
    injectAuthModal();
    ensureSupabaseClient();
    exposeApi();
    bindEvents();
    restoreSession();
  });
})();
