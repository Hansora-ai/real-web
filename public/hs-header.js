/* Hansora persistent header loader + auth/credits UI
   - Injects /hs-header.html into a placeholder element
   - Uses existing window.supabaseClient if present; otherwise creates it using embedded constants
   - Updates Login/Signup vs User menu + live credits/avatar quickly (session-first, then profile refresh)
*/
(function () {
  'use strict';

  const DEFAULT_HEADER_URL = '/hs-header.html';

  function q(sel, root) { return (root || document).querySelector(sel); }

  function safeText(el, txt) { if (el) el.textContent = txt; }

  async function ensureSupabaseClient() {
    // Prefer a client already created by the page (keeps existing logic intact).
    if (window.supabaseClient && window.supabaseClient.auth) return window.supabaseClient;

    // If the page didn't create one, try to create it here (requires @supabase/supabase-js loaded).
    const SUPABASE_URL = window.HS_SUPABASE_URL || 'https://qmaealblegvcwodlmeht.supabase.co';
    const SUPABASE_ANON_KEY = window.HS_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('supabase_js_missing');
    }
    if (!SUPABASE_ANON_KEY) {
      throw new Error('supabase_anon_key_missing');
    }

    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return window.supabaseClient;
  }

  function applyLoggedOutUI(root) {
    const navUser = q('#navUser', root);
    const btnLogin = q('#btnLoginSignup', root);
    const navCredits = q('#navCredits', root);
    if (navUser) {
      navUser.classList.add('hidden');
      navUser.classList.remove('flex');
    }
    if (btnLogin) btnLogin.classList.remove('hidden');
    if (navCredits) navCredits.textContent = '0⚡';
  }

  function applyLoggedInUI(root, credits, avatarUrl) {
    const navUser = q('#navUser', root);
    const btnLogin = q('#btnLoginSignup', root);
    const navCredits = q('#navCredits', root);

    if (btnLogin) btnLogin.classList.add('hidden');
    if (navUser) {
      navUser.classList.remove('hidden');
      navUser.classList.add('flex');
    }
    if (navCredits) navCredits.textContent = (typeof credits === 'number' ? credits : (credits || 0)) + '⚡';

    const avatarImg = q('#navAvatarImg', root);
    if (avatarImg && avatarUrl) {
      avatarImg.src = avatarUrl;
      avatarImg.classList.remove('hidden');
    }
  }

  async function refreshProfile(root, sb, user) {
    try {
      if (!user) return;
      const { data: profile, error } = await sb
        .from('profiles')
        .select('credits, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      const credits = profile && typeof profile.credits !== 'undefined' ? profile.credits : 0;
      window.HS_CURRENT_CREDITS = credits;
      window.HS_CURRENT_USER = user;

      applyLoggedInUI(root, credits, profile && profile.avatar_url ? profile.avatar_url : null);
    } catch (e) {
      console.warn('HSHeader refreshProfile failed', e);
    }
  }

  function bindMenu(root, sb) {
    // Avatar dropdown toggle (direct) + click-away
    const avatar = q('#navAvatar', root);
    const menu = q('#navMenu', root);

    if (avatar && menu) {
      avatar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.classList.toggle('hidden');
      });

      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') menu.classList.add('hidden');
      });

      // Click-away
      document.addEventListener('click', (e) => {
        if (menu.classList.contains('hidden')) return;
        if (!menu.contains(e.target) && !avatar.contains(e.target)) {
          menu.classList.add('hidden');
        }
      });
    }

    // Logout
    const btnLogout = q('#btnLogout', root);
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        try {
          await sb.auth.signOut();
        } catch (e) {
          console.warn('HSHeader logout failed', e);
        } finally {
          window.HS_CURRENT_USER = null;
          window.HS_CURRENT_CREDITS = 0;
          applyLoggedOutUI(root);
        }
      });
    }
  }

  async function initAuth(root) {
    let sb;
    try {
      sb = await ensureSupabaseClient();
    } catch (e) {
      console.warn('HSHeader supabase init failed', e);
      return;
    }

    bindMenu(root, sb);

    try {
      // Fast path: session (usually from local storage) -> show logged-in UI immediately.
      const { data: sessRes } = await sb.auth.getSession();
      const session = sessRes && sessRes.session ? sessRes.session : null;
      const user = session ? session.user : null;

      if (!user) {
        applyLoggedOutUI(root);
      } else {
        // Show placeholder credits instantly, then refresh from profiles.
        applyLoggedInUI(root, window.HS_CURRENT_CREDITS || 0, null);
        await refreshProfile(root, sb, user);
      }

      // React to auth changes (login/logout in another tab)
      sb.auth.onAuthStateChange(async (_event, _session) => {
        const u = _session && _session.user ? _session.user : null;
        if (!u) {
          applyLoggedOutUI(root);
          return;
        }
        applyLoggedInUI(root, window.HS_CURRENT_CREDITS || 0, null);
        await refreshProfile(root, sb, u);
      });
    } catch (e) {
      console.warn('HSHeader initAuth failed', e);
    }
  }

  async function mount(target, opts) {
    const options = opts || {};
    const headerUrl = options.headerUrl || DEFAULT_HEADER_URL;

    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('HSHeader mount target not found');

    // Inject header markup
    const res = await fetch(headerUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HSHeader fetch failed: ' + res.status);
    host.innerHTML = await res.text();

    // Init auth bindings
    await initAuth(host);

    return host;
  }

  window.HSHeader = { mount };
})();
