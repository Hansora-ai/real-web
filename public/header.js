(function () {
  'use strict';

  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const LOGO_URL = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/downloads/2025/ChatGPT%20Image%20Oct%2020,%202025,%2011_50_37%20AM.png';

  let sb = null;
  let currentUser = null;
  let currentCredits = 0;

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

  function injectHeader() {
    const mount = document.getElementById('sharedHeader');
    if (!mount || mount.dataset.hansoraHeaderMounted === '1') return;
    mount.dataset.hansoraHeaderMounted = '1';
    mount.innerHTML = `
      <header class="site-header auth-checking" id="siteHeader">
        <div class="shell nav">
          <a class="brand" href="/" aria-label="HANSORA AI home">
            <img src="${LOGO_URL}" alt="">
            <span>HANSORA AI</span>
          </a>
          <nav class="nav-links" aria-label="Primary navigation">
            <a href="/search-models.html">Image</a>
            <a href="/search-models.html">Video</a>
            <a href="/models.html">Features</a>
            <a href="/pricing.html">Pricing</a>
            <a href="/examples-prompts.html">Examples/Prompts</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div class="nav-actions">
            <button class="btn btn-ghost" type="button" id="btnLoginSignup">Login</button>
            <span class="credits-pill" id="navCredits">0⚡</span>
            <button class="avatar-button" type="button" id="navAvatar" aria-label="Open account menu">
              <img id="navAvatarImg" alt="" src="https://ui-avatars.com/api/?name=H&background=6366f1&color=fff">
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
            <input id="authEmail" placeholder="Email" required type="email" autocomplete="email">
            <input id="authPass" placeholder="Password" required type="password" autocomplete="current-password">
            <input class="hansora-hidden" id="authPass2" placeholder="Repeat password" type="password" autocomplete="new-password">
            <div class="hansora-auth-actions">
              <button class="btn btn-brand" id="btnDoLogin" type="button">Log in</button>
              <button class="btn" id="btnDoSignup" type="button">Sign up</button>
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
    const navCredits = el('navCredits');
    if (navCredits) navCredits.textContent = `${Number.isInteger(n) ? n : n.toFixed(2)}⚡`;
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
    if (navAvatarImg && user) navAvatarImg.src = avatarUrlFor(user);
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
  }

  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    const title = el('authTitle');
    const pass2 = el('authPass2');
    const doLogin = el('btnDoLogin');
    const doSignup = el('btnDoSignup');
    if (mode === 'signup') {
      if (title) title.textContent = 'Sign up';
      if (pass2) pass2.classList.remove('hansora-hidden');
      if (doSignup) doSignup.classList.add('btn-brand');
      if (doLogin) doLogin.classList.remove('btn-brand');
    } else {
      if (title) title.textContent = 'Log in';
      if (pass2) pass2.classList.add('hansora-hidden');
      if (doLogin) doLogin.classList.add('btn-brand');
      if (doSignup) doSignup.classList.remove('btn-brand');
    }
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
    const doSignup = el('btnDoSignup');
    const modal = el('authModal');

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
          openAuth('signup');
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

    if (doSignup) {
      doSignup.addEventListener('click', async function () {
        const emailIn = el('authEmail');
        const passIn = el('authPass');
        const pass2In = el('authPass2');
        const msg = el('authMsg');
        if (authMode !== 'signup') { setAuthMode('signup'); if (msg) msg.textContent = ''; return; }
        if (!emailIn.value || !passIn.value) { if (msg) msg.textContent = 'Enter email & password.'; return; }
        if (passIn.value !== pass2In.value) { if (msg) msg.textContent = 'Passwords do not match.'; return; }
        if (msg) msg.textContent = 'Creating account…';
        const { error } = await sb.auth.signUp({ email: emailIn.value.trim(), password: passIn.value.trim() });
        if (error) { if (msg) msg.textContent = error.message; return; }
        if (msg) msg.textContent = 'Check your email to confirm, then log in.';
        setAuthMode('login');
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
    injectHeader();
    injectAuthModal();
    ensureSupabaseClient();
    exposeApi();
    bindEvents();
    restoreSession();
  });
})();
