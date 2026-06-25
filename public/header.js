(function () {
  'use strict';

  const SUPABASE_URL = 'https://qmaealblegvcwodlmeht.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c';
  const LOGO_URL = 'https://qmaealblegvcwodlmeht.supabase.co/storage/v1/object/public/website%20content/Untitled%20design%20(23).png';
  const CACHE_PREFIX = 'hansora.header.';
  const AFFILIATE_REF_KEY = 'hansora_affiliate_ref';
  const AFFILIATE_PENDING_KEY = 'hansora_pending_affiliate_ref';
  const AFFILIATE_DONE_PREFIX = 'hansora_affiliate_registered.';
  const AFFILIATE_COOKIE_NAME = 'hansora_affiliate_ref';
  const AFFILIATE_REF_MAX_AGE = 60 * 60 * 24 * 30;
  const SIGNUP_OFFER_DELAY_MS = 3 * 60 * 1000;
  const SIGNUP_OFFER_PENDING_PREFIX = 'hansora_signup_offer_pending.';
  const SIGNUP_OFFER_DISMISSED_PREFIX = 'hansora_signup_offer_dismissed.';
  const SIGNUP_OFFER_OAUTH_STARTED_KEY = 'hansora_signup_offer_oauth_started_at';
  const SIGNUP_OFFER_URL = '/pricing.html?offer_popup=1';
  const GROK_VIDEO_CREDIT_THRESHOLD = 4;

  function ensureI18nRuntime() {
    if (window.HansoraI18n || document.querySelector('script[data-hansora-i18n]')) return;
    const script = document.createElement('script');
    script.src = '/i18n.js';
    script.defer = true;
    script.dataset.hansoraI18n = '1';
    document.head.appendChild(script);
  }

  let sb = null;
  let currentUser = null;
  let currentCredits = 0;
  let signupOfferTimer = null;

  const IMAGE_MENU_MODELS = [
    { label: 'GPT Image 2', id: 'gpt-image-2', icon: 'G2', note: 'Latest image generation' },
    { label: 'Nano Banana 2', id: 'nano-banana-2', icon: 'N2', note: 'Fast image edits' },
    { label: 'Nano Banana Pro', id: 'nano-banana-pro', icon: 'NP', note: 'Pro image generation' },
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
    { label: 'Image Upscale', href: '/upscale.html', icon: 'UP', note: 'Increase image quality' },
    { label: 'Full angles', href: '/expand.html?mode=angles', icon: 'FA', note: 'Different angles chosen' },
    { label: 'Expand', href: '/expand.html?mode=expand', icon: 'EX', note: 'Extend image edges' },
    { label: 'Face swap', href: '/expand.html?mode=face-swap', icon: 'FS', note: 'Chosen face swap' },
    { label: 'Character', href: '/character.html', icon: 'CH', note: 'Character creator' },
    { label: 'Product Card', href: '/product_card.html', icon: 'PC', note: 'Product selling cards' },
  ];

  const PROMPT_BUILDER_TOOL = {
    label: 'Prompt Builder',
    href: '/prompt-builder.html',
    icon: 'PB',
    note: 'Cartoon prompt builder'
  };

  const VIDEO_MENU_ITEMS = [
    { label: 'Kid Cartoon', href: '/kid-cartoon.html', icon: 'KC', note: 'Add your kid in cartoon' },
    { label: 'Seedance 2.0', id: 'seedance-2', icon: 'S2', note: 'Cinematic video model' },
    { label: 'Kling 3.0', id: 'kling-3', icon: 'K3', note: 'Advanced video generation' },
    { label: 'Seedance 2.0 Mini', id: 'seedance-2-mini', icon: 'SM', note: 'Fast cinematic video model' },
    { label: 'Kling 3 Turbo', id: 'kling-3-turbo', icon: 'KT', note: 'Fast text or image video model' },
    { label: 'Gemini Omni', id: 'gemini-omni-video', icon: 'GO', note: 'Prompt, image, and video inputs' },
    { label: 'HappyHorse 1.0', id: 'happyhorse-1', icon: 'HH', note: 'Video and audio model' },
    { label: 'Veo 3.1', id: 'veo31', icon: 'V3', note: 'Google video model' },
    { label: 'Grok', id: 'grok-video', icon: 'GX', note: 'Cinematic video' },
    { label: 'Kling 2.6', id: 'kling26', icon: 'K2', note: 'Video with sound' },
    { label: 'Kling 2.5 Turbo', id: 'kling-2-5-turbo', icon: 'KT', note: 'Fast Kling video model' },
    { label: 'Wan 2.7', id: 'wan-2-7-video', icon: 'W', note: 'First and last frame control' },
    { label: 'Kling Motion Control', id: 'kling-motion-control', icon: 'KM', note: 'Motion transfer' },
    { label: 'Aleph', id: 'aleph', icon: 'A', note: 'Video transformation' },
    { label: 'Video upscale', href: '/upscale.html?mode=video', icon: 'VU', note: 'Increase video quality' },
    { label: 'Lips sync / Avatar', href: '/lipsync.html', icon: 'LS', note: 'Talking avatar video' },
  ];

  const AUDIO_MENU_ITEMS = [
    { label: 'Text to speech', href: '/audio.html?tool=text-to-speech', icon: 'T2', note: 'Generate voice from text' },
    { label: 'Voice isolater', href: '/audio.html?tool=voice-isolater', icon: 'VI', note: 'Separate clean vocals' },
    { label: 'Voice changer', href: '/audio.html?tool=voice-changer', icon: 'VC', note: 'Transform a voice' },
    { label: 'Song Creation', href: '/audio.html?tool=song-creation', icon: 'SC', note: 'Create music tracks' },
  ];

  const FEATURE_MENU_ITEMS = [
    { label: 'Kid Cartoon', href: '/kid-cartoon.html', icon: 'KC', note: 'Add your kid in cartoon' },
    { label: 'Video upscale', href: '/upscale.html?mode=video', icon: 'VU', note: 'Increase video quality' },
    { label: 'Lipsync Avatar', href: '/lipsync.html', icon: 'LA', note: 'Talking avatar video' },
    { label: 'Text to speech', href: '/audio.html?tool=text-to-speech', icon: 'T2', note: 'Generate voice from text' },
    { label: 'Voice isolater', href: '/audio.html?tool=voice-isolater', icon: 'VI', note: 'Separate clean vocals' },
    { label: 'Song Creation', href: '/audio.html?tool=song-creation', icon: 'SC', note: 'Create music tracks' },
    { label: 'Hook analyse', href: '/analyse.html', icon: 'HA', note: 'Analyse hooks and ideas' },
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function isTelegramWebView() {
    const tg = window.Telegram && window.Telegram.WebApp;
    const ua = navigator.userAgent || '';
    const search = `${window.location.search || ''}${window.location.hash || ''}`;
    return !!tg || /\bTelegram\b/i.test(ua) || /tgWebApp/i.test(search);
  }

  function applyTelegramViewportFix() {
    if (!isTelegramWebView()) return;

    const root = document.documentElement;
    const body = document.body;
    const tg = window.Telegram && window.Telegram.WebApp;

    root.classList.add('hansora-telegram-webview');
    if (body) body.classList.add('hansora-telegram-webview');

    function updateViewportVars() {
      const viewportHeight = tg && Number(tg.viewportHeight) ? Number(tg.viewportHeight) : window.innerHeight;
      const stableViewportHeight = tg && Number(tg.stableViewportHeight) ? Number(tg.stableViewportHeight) : viewportHeight;
      root.style.setProperty('--hansora-tg-vh', `${Math.max(viewportHeight, stableViewportHeight)}px`);
      root.style.setProperty('--hansora-tg-safe-top', '0px');
      root.style.setProperty('--hansora-tg-safe-bottom', '0px');
    }

    try {
      if (tg) {
        tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
        if (typeof tg.onEvent === 'function') tg.onEvent('viewportChanged', updateViewportVars);
      }
    } catch (_) {}

    updateViewportVars();
    window.addEventListener('resize', updateViewportVars, { passive: true });
    window.addEventListener('orientationchange', updateViewportVars, { passive: true });
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

  let analyticsAuthCache = null;

  function refreshAnalyticsAuthCache() {
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
  }

  function readAnalyticsAuth() {
    return analyticsAuthCache || window.__hansoraAnalyticsAuth || null;
  }

  function clickDestination(element) {
    const raw = element && element.getAttribute ? element.getAttribute('href') || '' : '';
    if (!raw || raw.charAt(0) === '#') return raw.slice(0, 180) || null;
    try {
      const url = new URL(raw, location.href);
      return url.origin === location.origin
        ? `${url.pathname}${url.hash}`.slice(0, 300)
        : `${url.origin}${url.pathname}`.slice(0, 300);
    } catch (_) {
      return raw.slice(0, 300);
    }
  }

  function analyticsSessionId() {
    const key = 'hansora.analytics.session_id';
    try {
      let value = sessionStorage.getItem(key);
      if (!value) {
        value = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function bindGlobalClickTracking() {
    if (window.__hansoraGlobalClickTrackingBound) return;
    window.__hansoraGlobalClickTrackingBound = true;
    refreshAnalyticsAuthCache();
    window.addEventListener('storage', function (event) {
      if (/^sb-.*-auth-token$/.test(event.key || '')) refreshAnalyticsAuthCache();
    });

    document.addEventListener('click', function (event) {
      try {
        const target = event.target && event.target.closest
          ? event.target.closest('a,button,[role="button"]')
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
        ).replace(/\s+/g, ' ').trim().slice(0, 180);

        fetch(`${SUPABASE_URL}/rest/v1/click_events`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${auth.accessToken}`,
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
            page_path: `${location.pathname}${location.hash || ''}`.slice(0, 300),
            session_id: analyticsSessionId(),
            device_type: window.matchMedia && window.matchMedia('(max-width: 900px)').matches
              ? 'mobile'
              : 'desktop'
          })
        }).catch(function () {});
      } catch (_) {}
    }, true);
  }

  function getAffiliateRefFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const rawRef = params.get('ref') || params.get('affiliate') || params.get('affiliate_ref') || '';
      return normalizeAffiliateRef(rawRef);
    } catch (_) {
      return '';
    }
  }

  function normalizeAffiliateRef(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toUpperCase();
  }

  function writeAffiliateCookie(ref) {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${AFFILIATE_COOKIE_NAME}=${encodeURIComponent(ref)}; Max-Age=${AFFILIATE_REF_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    } catch (_) {}
  }

  function readAffiliateCookie() {
    try {
      const prefix = `${AFFILIATE_COOKIE_NAME}=`;
      const parts = String(document.cookie || '').split(';');
      for (const part of parts) {
        const value = part.trim();
        if (value.indexOf(prefix) === 0) return normalizeAffiliateRef(decodeURIComponent(value.slice(prefix.length)));
      }
    } catch (_) {}
    return '';
  }

  function clearAffiliateCookie() {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${AFFILIATE_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    } catch (_) {}
  }

  function clearStoredAffiliateRef() {
    try {
      localStorage.removeItem(AFFILIATE_REF_KEY);
      localStorage.removeItem(AFFILIATE_PENDING_KEY);
    } catch (_) {}
    try {
      sessionStorage.removeItem(AFFILIATE_REF_KEY);
    } catch (_) {}
    clearAffiliateCookie();
  }

  function stripAffiliateRefFromCurrentUrl() {
    try {
      const url = new URL(location.href);
      const before = url.href;
      url.searchParams.delete('ref');
      url.searchParams.delete('affiliate');
      url.searchParams.delete('affiliate_ref');
      if (url.href !== before && history && history.replaceState) {
        history.replaceState(history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (_) {}
  }

  function stripAffiliateRefFromLinks() {
    try {
      document.querySelectorAll('a[href]').forEach(function (link) {
        const raw = link.getAttribute('href') || '';
        if (!raw || raw.charAt(0) === '#') return;
        const url = new URL(raw, location.origin);
        if (url.origin !== location.origin) return;
        const before = `${url.pathname}${url.search}${url.hash}`;
        url.searchParams.delete('ref');
        url.searchParams.delete('affiliate');
        url.searchParams.delete('affiliate_ref');
        const after = `${url.pathname}${url.search}${url.hash}`;
        if (after !== before) link.setAttribute('href', after);
      });
    } catch (_) {}
  }

  function rememberAffiliateRef(ref, source) {
    const code = normalizeAffiliateRef(ref);
    if (!code) return '';

    const pending = {
      code,
      source: source || 'url',
      captured_at: new Date().toISOString(),
      landing_path: `${location.pathname || '/'}${location.search || ''}`,
      landing_url: location.href
    };

    try {
      localStorage.setItem(AFFILIATE_REF_KEY, code);
      localStorage.setItem(AFFILIATE_PENDING_KEY, JSON.stringify(pending));
    } catch (_) {}

    try {
      sessionStorage.setItem(AFFILIATE_REF_KEY, code);
    } catch (_) {}

    writeAffiliateCookie(code);
    return code;
  }

  function captureAffiliateRef() {
    const ref = getAffiliateRefFromUrl();
    if (ref) {
      rememberAffiliateRef(ref, 'url');
    }
    return ref;
  }

  function getStoredAffiliateRef() {
    const urlRef = getAffiliateRefFromUrl();
    if (urlRef) return rememberAffiliateRef(urlRef, 'url');

    try {
      const localRef = normalizeAffiliateRef(localStorage.getItem(AFFILIATE_REF_KEY));
      if (localRef) return localRef;
    } catch (_) {}

    try {
      const sessionRef = normalizeAffiliateRef(sessionStorage.getItem(AFFILIATE_REF_KEY));
      if (sessionRef) {
        rememberAffiliateRef(sessionRef, 'session');
        return sessionRef;
      }
    } catch (_) {}

    const cookieRef = readAffiliateCookie();
    if (cookieRef) {
      rememberAffiliateRef(cookieRef, 'cookie');
      return cookieRef;
    }

    return '';
  }

  function getPendingAffiliateRef(user) {
    try {
      const pending = JSON.parse(localStorage.getItem(AFFILIATE_PENDING_KEY) || '{}');
      if (!pending || !pending.code) return getStoredAffiliateRef();
      if (user && pending.user_id && pending.user_id !== user.id) return '';
      return normalizeAffiliateRef(pending.code);
    } catch (_) {
      return getStoredAffiliateRef();
    }
  }

  function markAffiliateRegistered(user, code) {
    const ref = normalizeAffiliateRef(code);
    if (!user || !user.id || !ref) return;
    try {
      localStorage.setItem(`${AFFILIATE_DONE_PREFIX}${user.id}.${ref}`, '1');
      const pending = JSON.parse(localStorage.getItem(AFFILIATE_PENDING_KEY) || '{}');
      if (!pending.user_id || pending.user_id === user.id) {
        localStorage.removeItem(AFFILIATE_PENDING_KEY);
      }
      localStorage.removeItem(AFFILIATE_REF_KEY);
    } catch (_) {}
    clearStoredAffiliateRef();
    stripAffiliateRefFromCurrentUrl();
    stripAffiliateRefFromLinks();
  }

  async function registerAffiliateReferral(user, code) {
    const ref = normalizeAffiliateRef(code || getPendingAffiliateRef(user) || getStoredAffiliateRef());
    if (!sb || !user || !user.id || !ref) return;

    try {
      if (localStorage.getItem(`${AFFILIATE_DONE_PREFIX}${user.id}.${ref}`)) return;
    } catch (_) {}

    try {
      const { data: referrer, error: accountError } = await sb
        .from('affiliate_accounts')
        .select('user_id, affiliate_code')
        .eq('affiliate_code', ref)
        .maybeSingle();

      if (accountError) throw accountError;
      if (!referrer || !referrer.user_id || referrer.user_id === user.id) return;

      const { data: existing, error: existingError } = await sb
        .from('affiliate_referrals')
        .select('id')
        .eq('referred_user_id', user.id)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        markAffiliateRegistered(user, ref);
        return;
      }

      const { error: insertError } = await sb.from('affiliate_referrals').insert({
        referrer_user_id: referrer.user_id,
        referred_user_id: user.id,
        affiliate_code: ref,
        status: 'registered'
      });

      if (insertError) throw insertError;
      markAffiliateRegistered(user, ref);
    } catch (affiliateError) {
      console.warn('Affiliate referral registration failed', affiliateError);
    }
  }

  function shouldRedirectWhenLoggedOut() {
    return false;
  }

  function redirectLoggedOutHome() {
    if (!shouldRedirectWhenLoggedOut()) return;
    const target = location.origin ? `${location.origin}/index.html` : '/index.html';
    if (location.href !== target) location.href = target;
  }

  function formatCredits(value) {
    const n = Number(value || 0);
    return `${Number.isInteger(n) ? n : n.toFixed(2)}⚡`;
  }

  function modelHref(id) {
    return `/search-models.html?model=${encodeURIComponent(id)}`;
  }

  function videoLandingHref(credits) {
    return modelHref(Number(credits || 0) < GROK_VIDEO_CREDIT_THRESHOLD ? 'grok-video' : 'kling-3');
  }

  function updateVideoLandingLink() {
    const link = document.querySelector('[data-hansora-video-landing]');
    if (link) link.setAttribute('href', withAffiliateRef(videoLandingHref(currentCredits)));
  }

  function withAffiliateRef(href) {
    if (currentUser && currentUser.id) return href;
    const ref = getStoredAffiliateRef();
    if (!ref || !href || href.charAt(0) === '#') return href;

    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return href;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return href;
    }
  }

  function preserveAffiliateRefOnLink(link) {
    if (!link || currentUser && currentUser.id) return;
    const raw = link.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#' || /^(?:mailto:|tel:|javascript:|data:)/i.test(raw)) return;

    const ref = getStoredAffiliateRef();
    if (!ref) return;

    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return;
      if (!url.searchParams.get('ref')) url.searchParams.set('ref', ref);
      link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function preserveAffiliateRefAcrossPageLinks() {
    if (currentUser && currentUser.id) return;

    document.querySelectorAll('a[href]').forEach(preserveAffiliateRefOnLink);

    document.addEventListener('click', function (event) {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (link) preserveAffiliateRefOnLink(link);
    }, true);

    if (window.MutationObserver && document.body) {
      const observer = new MutationObserver(function (records) {
        if (currentUser && currentUser.id) {
          observer.disconnect();
          return;
        }
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (!node || node.nodeType !== 1) return;
            if (node.matches && node.matches('a[href]')) preserveAffiliateRefOnLink(node);
            if (node.querySelectorAll) node.querySelectorAll('a[href]').forEach(preserveAffiliateRefOnLink);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function menuIconClass(index) {
    return index % 4 === 0 ? 'blue' : index % 4 === 1 ? 'violet' : index % 4 === 2 ? 'lime' : 'pink';
  }

  function itemHref(item) {
    return withAffiliateRef(item.href || modelHref(item.id));
  }

  function itemData(item) {
    return item.id && !item.href ? ` data-hansora-model="${item.id}"` : '';
  }

  function renderMegaItems(items, offset) {
    return items.map((item, index) => `
      <a class="hansora-mega-item" href="${itemHref(item)}"${itemData(item)}>
        <span class="hansora-mega-icon ${menuIconClass(index + (offset || 0))}">${item.icon}</span>
        <span class="hansora-mega-copy">
          <strong>${item.label}</strong>
          <em>${item.note}</em>
        </span>
      </a>`).join('');
  }

  function renderMegaMenu(config) {
    const sections = config.sections.map((section, sectionIndex) => `
      <section>
        <div class="hansora-mega-eyebrow">${section.title}</div>
        <div class="hansora-mega-grid">${renderMegaItems(section.items, sectionIndex * 2)}</div>
      </section>`).join('');
    return `
      <div class="hansora-mega-menu ${config.className || ''}" role="menu" aria-label="${config.label}">
        ${sections}
      </div>`;
  }

  function renderNavMenu(label, href, config) {
    const triggerData = config && config.videoLanding ? ' data-hansora-video-landing="1"' : '';
    return `
      <span class="hansora-nav-item">
        <a class="hansora-nav-trigger" href="${withAffiliateRef(href)}"${triggerData}>${label}</a>
        ${renderMegaMenu(config)}
      </span>`;
  }

  function injectHeaderStyles() {
    if (document.getElementById('hansoraHeaderMegaStyles')) return;
    const style = document.createElement('style');
    style.id = 'hansoraHeaderMegaStyles';
    style.textContent = `
      .nav-links .hansora-nav-item{ position:relative; display:inline-flex; align-items:center; }
      .site-header .shell.nav{ position:relative; }
      .site-header .nav-links{ position:absolute; left:50%; transform:translateX(-50%); }
      .hansora-brand-mobile{ display:none; }
      .nav-links .hansora-nav-trigger{ display:inline-flex; align-items:center; gap:8px; text-decoration:none; color:inherit; }
      .nav-links .hansora-nav-trigger::after{ content:""; width:6px; height:6px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(45deg); opacity:.55; margin-top:-3px; transition:transform .18s ease, opacity .18s ease; }
      .nav-links .hansora-nav-item:hover .hansora-nav-trigger::after,
      .nav-links .hansora-nav-item:focus-within .hansora-nav-trigger::after{ transform:rotate(225deg); margin-top:3px; opacity:.9; }
      .hansora-mega-menu{
        position:absolute;
        top:calc(100% + 18px);
        left:50%;
        width:min(940px,calc(100vw - 32px));
        transform:translateX(-50%) translateY(8px);
        display:grid;
        grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);
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
      .hansora-mega-wide{
        width:min(700px,calc(100vw - 32px));
        grid-template-columns:1fr;
      }
      .hansora-mega-video{
        width:min(940px,calc(100vw - 32px));
      }
      .hansora-mega-video .hansora-mega-grid{
        grid-template-columns:repeat(3,minmax(0,1fr));
      }
      .hansora-mega-compact{
        width:min(560px,calc(100vw - 32px));
        grid-template-columns:1fr;
      }
      .hansora-mega-menu::before{ content:""; position:absolute; left:0; right:0; top:-22px; height:22px; }
      .nav-links .hansora-nav-item:hover .hansora-mega-menu,
      .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{
        opacity:1;
        visibility:visible;
        pointer-events:auto;
        transform:translateX(-50%) translateY(0);
      }
      .hansora-mega-eyebrow{
        margin:0 0 10px;
        color:rgba(255,255,255,.48);
        font-size:11px;
        font-weight:850;
        letter-spacing:.12em;
        text-transform:uppercase;
      }
      .hansora-mega-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .hansora-mega-item{
        display:flex;
        align-items:center;
        gap:12px;
        height:70px;
        min-width:0;
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
        width:44px;
        height:44px;
        flex:0 0 44px;
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
      .hansora-mega-copy{ display:block; min-width:0; overflow:hidden; }
      .hansora-mega-item strong{
        display:-webkit-box;
        color:rgba(255,255,255,.94);
        font-size:13px;
        line-height:1.12;
        font-weight:900;
        overflow:hidden;
        text-overflow:ellipsis;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
      }
      .hansora-mega-item em{
        display:-webkit-box;
        margin-top:4px;
        color:rgba(255,255,255,.48);
        font-size:11px;
        font-style:normal;
        line-height:1.18;
        overflow:hidden;
        text-overflow:ellipsis;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
      }
      @media (max-width:900px){
        .site-header .nav-links{ position:static; transform:none; }
        .hansora-mega-menu{ left:0; transform:translateX(-16px) translateY(8px); grid-template-columns:1fr; width:min(92vw,520px); max-height:72vh; overflow:auto; }
        .nav-links .hansora-nav-item:hover .hansora-mega-menu,
        .nav-links .hansora-nav-item:focus-within .hansora-mega-menu{ transform:translateX(-16px) translateY(0); }
      }
      .hansora-mobile-pricing{
        position:relative;
        min-width:76px;
        height:42px;
        display:inline-flex;
        align-items:flex-start;
        justify-content:center;
        padding:8px 12px 0;
        border:1px solid rgba(255,255,255,.10);
        border-radius:14px;
        background:linear-gradient(145deg,#181a21,#0f1117);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 7px 16px rgba(0,0,0,.24);
        color:#fff;
        font-size:13px;
        font-weight:900;
        line-height:1;
        letter-spacing:.01em;
        text-decoration:none;
        white-space:nowrap;
      }
      .hansora-mobile-pricing > span{
        transform:translateY(2px);
      }
      .hansora-mobile-pricing-badge{
        position:absolute;
        left:50%;
        bottom:-8px;
        transform:translateX(-50%);
        min-width:64px;
        padding:3px 7px;
        border:1px solid rgba(255,255,255,.16);
        border-radius:999px;
        background:#ef233c;
        box-shadow:0 5px 13px rgba(239,35,60,.38);
        color:#fff;
        font-size:9px;
        font-weight:950;
        line-height:1;
        text-align:center;
        letter-spacing:.04em;
      }
      @media (max-width:720px){
        .site-header .shell.nav{
          min-height:58px !important;
          padding-left:7px !important;
          padding-right:7px !important;
          gap:5px !important;
        }
        .site-header .brand{
          min-width:0 !important;
          gap:5px !important;
          margin-right:auto !important;
        }
        .site-header .brand img{
          width:32px !important;
          height:32px !important;
          flex:0 0 32px !important;
        }
        .site-header .brand span{
          font-size:16px !important;
          letter-spacing:.01em !important;
          white-space:nowrap !important;
        }
        .hansora-brand-full{ display:none; }
        .hansora-brand-mobile{ display:inline; }
        .site-header .nav-actions{
          gap:5px !important;
          margin-left:0 !important;
        }
        .site-header .credits-pill{
          min-height:32px !important;
          padding:0 7px !important;
          border-radius:12px !important;
          font-size:12px !important;
          white-space:nowrap !important;
        }
        .site-header .avatar-button{
          width:32px !important;
          height:32px !important;
          min-width:32px !important;
          flex:0 0 32px !important;
        }
        .site-header .avatar-button img{
          width:100% !important;
          height:100% !important;
        }
        .hansora-mobile-pricing{
          position:relative;
          min-width:62px;
          height:34px;
          display:inline-flex;
          align-items:flex-start;
          justify-content:center;
          padding:6px 8px 0;
          font-size:11px;
        }
        .hansora-mobile-pricing-badge{
          min-width:53px;
          padding:3px 6px;
          font-size:8px;
        }
      }
      @media (max-width:390px){
        .site-header .brand img{ width:29px !important; height:29px !important; flex-basis:29px !important; }
        .site-header .brand span{ font-size:14px !important; }
        .site-header .credits-pill{ padding:0 6px !important; font-size:11px !important; }
        .hansora-mobile-pricing{ min-width:58px; padding-left:6px; padding-right:6px; }
      }
      html.hansora-telegram-webview,
      html.hansora-telegram-webview body{
        min-height:var(--hansora-tg-vh,100dvh);
        height:auto;
        overflow-x:hidden;
      }
      html.hansora-telegram-webview body{
        margin-top:0 !important;
        padding-top:0 !important;
      }
      html.hansora-telegram-webview #sharedHeader{
        margin-top:0 !important;
        padding-top:0 !important;
        transform:none !important;
      }
      html.hansora-telegram-webview .site-header{
        top:0 !important;
        margin-top:0 !important;
        padding-top:0 !important;
        transform:none !important;
      }
      html.hansora-telegram-webview main{
        min-height:auto;
      }
      @media (max-width:900px){
        html.hansora-telegram-webview .site-header .shell.nav{
          min-height:64px;
        }
      }
      @media (max-width:560px){ .hansora-mega-grid{ grid-template-columns:1fr; } }
      .hansora-offer-modal{
        position:fixed;
        inset:0;
        z-index:2147483000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(3,6,18,.72);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
        opacity:0;
        pointer-events:none;
        transition:opacity .22s ease;
      }
      .hansora-offer-modal.is-open{
        opacity:1;
        pointer-events:auto;
      }
      .hansora-offer-panel{
        position:relative;
        width:min(1120px,100%);
        height:min(760px,calc(100dvh - 36px));
        border:1px solid rgba(255,255,255,.16);
        border-radius:28px;
        overflow:hidden;
        background:#070912;
        box-shadow:0 34px 110px rgba(0,0,0,.58);
        transform:translateY(24px) scale(.98);
        transition:transform .24s ease;
      }
      .hansora-offer-modal.is-open .hansora-offer-panel{
        transform:translateY(0) scale(1);
      }
      .hansora-offer-modal.is-closing{
        opacity:0;
      }
      .hansora-offer-modal.is-closing .hansora-offer-panel{
        transform:translateY(110vh) scale(.98);
      }
      .hansora-offer-frame{
        width:100%;
        height:100%;
        border:0;
        display:block;
        background:#070912;
      }
      .hansora-offer-close{
        position:absolute;
        top:14px;
        right:14px;
        z-index:3;
        width:40px;
        height:40px;
        border-radius:999px;
        border:0;
        background:transparent;
        color:#fff;
        font-size:28px;
        line-height:0;
        font-weight:800;
        box-shadow:none;
        outline:none;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:0;
        text-align:center;
      }
      .hansora-offer-close:hover{ background:transparent; color:#fff; opacity:.82; }
      .hansora-offer-close:focus,
      .hansora-offer-close:focus-visible{ outline:none; box-shadow:none; }
      @media (max-width:720px){
        .hansora-offer-modal{ padding:10px; }
        .hansora-offer-panel{
          height:calc(100dvh - 20px);
          border-radius:22px;
        }
        .hansora-offer-close{
          top:10px;
          right:10px;
          width:40px;
          height:40px;
        }
      }
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
          <a class="brand" href="${withAffiliateRef('/')}" aria-label="HANSORA AI home">
            <img src="${LOGO_URL}" alt="">
            <span><span class="hansora-brand-full">HANSORA AI</span><span class="hansora-brand-mobile">HANSORA</span></span>
          </a>
          <nav class="nav-links" aria-label="Primary navigation">
            ${renderNavMenu('Image', '/search-models.html', {
              label: 'Image tools and models',
              sections: [
                { title: 'Image models', items: IMAGE_MENU_MODELS },
                { title: 'Image tools', items: IMAGE_MENU_TOOLS },
              ]
            })}
            ${renderNavMenu('Video', videoLandingHref(cachedCredits), {
              label: 'Video models',
              className: 'hansora-mega-wide hansora-mega-video',
              videoLanding: true,
              sections: [
                { title: 'Video models', items: VIDEO_MENU_ITEMS },
              ]
            })}
            ${renderNavMenu('Features', '/models.html', {
              label: 'Feature tools',
              className: 'hansora-mega-wide',
              sections: [
                { title: 'Image tools', items: [...IMAGE_MENU_TOOLS, PROMPT_BUILDER_TOOL] },
                { title: 'Video and audio tools', items: FEATURE_MENU_ITEMS },
              ]
            })}
            ${renderNavMenu('Audio', '/audio.html', {
              label: 'Audio tools',
              className: 'hansora-mega-compact',
              sections: [
                { title: 'Audio tools', items: AUDIO_MENU_ITEMS },
              ]
            })}
          </nav>
          <div class="nav-actions">
            <a class="hansora-mobile-pricing" href="${withAffiliateRef('/pricing.html')}" aria-label="Pricing, 30% off">
              <span>Pricing</span>
              <strong class="hansora-mobile-pricing-badge">30% OFF</strong>
            </a>
            <button class="btn btn-ghost" type="button" id="btnLoginSignup" style="display:${cachedLoggedIn ? 'none' : 'inline-flex'}">Login</button>
            <span class="credits-pill" id="navCredits" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">${formatCredits(cachedCredits)}</span>
            <button class="avatar-button" type="button" id="navAvatar" aria-label="Open account menu" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}">
              <img id="navAvatarImg" alt="" src="${cachedAvatar}">
            </button>
            <a class="btn btn-primary" href="${withAffiliateRef('/search-models.html')}" id="btnGetStarted">Start creating</a>
          </div>
        </div>
        <div class="user-menu" id="navMenu">
          <a href="${withAffiliateRef('/profile.html')}">Profile</a>
          <a href="${withAffiliateRef('/usage.html')}">History</a>
          <a href="${withAffiliateRef('/pricing.html')}">Credits</a>
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
              <span>Continue with Google</span>
            </button>
            <p class="hansora-auth-msg" style="margin:12px 0 0;color:rgba(255,255,255,.72);line-height:1.45;">
              For account safety, sign up and login are currently available only with a Google account.
            </p>
            <div class="hansora-auth-divider" style="display:none;"><span>or</span></div>
            <input id="authEmail" style="display:none;" placeholder="Email" type="email" autocomplete="email">
            <input id="authPass" style="display:none;" placeholder="Password" type="password" autocomplete="current-password">
            <div class="hansora-auth-actions" style="display:none;">
              <button class="btn btn-brand" id="btnDoLogin" type="button">Log in</button>
              <a class="btn" id="btnGoSignup" href="${withAffiliateRef('/login.html?mode=signup')}">Sign up</a>
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
    updateVideoLandingLink();
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
    analyticsAuthCache = null;
    window.__hansoraAnalyticsAuth = null;
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
    updateVideoLandingLink();
    redirectLoggedOutHome();
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
      try {
        localStorage.removeItem(offerDismissedKey(user));
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
      return { ...ins.data, __hansoraNewSignup: true };
    }
    const profileCreatedAt = await getProfileCreatedAt(user.id);
    return profileCreatedAt ? { ...data, __hansoraProfileCreatedAt: profileCreatedAt } : data;
  }

  async function getProfileCreatedAt(userId) {
    if (!sb || !userId) return '';
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('created_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return '';
      return data && data.created_at ? String(data.created_at) : '';
    } catch (_) {
      return '';
    }
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

  function inOfferPopupFrame() {
    try {
      return window.self !== window.top || new URLSearchParams(location.search || '').get('offer_popup') === '1';
    } catch (_) {
      return false;
    }
  }

  function offerPendingKey(user) {
    return user && user.id ? `${SIGNUP_OFFER_PENDING_PREFIX}${user.id}` : '';
  }

  function offerDismissedKey(user) {
    return user && user.id ? `${SIGNUP_OFFER_DISMISSED_PREFIX}${user.id}` : '';
  }

  function isSignupOfferDismissed(user) {
    const key = offerDismissedKey(user);
    if (!key) return true;
    try {
      return localStorage.getItem(key) === '1';
    } catch (_) {
      return false;
    }
  }

  function isRecentTimestamp(raw, windowMs) {
    if (!raw) return false;
    const createdAt = Date.parse(raw);
    if (!Number.isFinite(createdAt)) return false;
    return Date.now() - createdAt >= 0 && Date.now() - createdAt <= windowMs;
  }

  function isRecentlyCreatedUser(user) {
    return isRecentTimestamp(user && (user.created_at || user.createdAt), 30 * 60 * 1000);
  }

  function rememberSignupOfferOAuthStart() {
    try {
      localStorage.setItem(SIGNUP_OFFER_OAUTH_STARTED_KEY, String(Date.now()));
    } catch (_) {}
  }

  function consumeRecentSignupOfferOAuthStart() {
    try {
      const startedAt = Number(localStorage.getItem(SIGNUP_OFFER_OAUTH_STARTED_KEY) || 0);
      if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
      localStorage.removeItem(SIGNUP_OFFER_OAUTH_STARTED_KEY);
      return Date.now() - startedAt >= 0 && Date.now() - startedAt <= 30 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }

  function handleSignupOffer(user, profile) {
    if (profile && profile.__hansoraNewSignup) {
      scheduleSignupOffer(user, true);
      return;
    }
    if (profile && isRecentTimestamp(profile.__hansoraProfileCreatedAt, 30 * 60 * 1000)) {
      scheduleSignupOffer(user, false);
      return;
    }
    if (isRecentlyCreatedUser(user)) {
      scheduleSignupOffer(user, false);
      return;
    }
    if (consumeRecentSignupOfferOAuthStart()) {
      scheduleSignupOffer(user, false);
      return;
    }
    resumeSignupOffer(user);
  }

  function closeSignupOffer(user) {
    const modal = document.getElementById('hansoraSignupOffer');
    if (!modal) return;
    if (user && user.id) {
      try {
        localStorage.setItem(offerDismissedKey(user), '1');
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
    }
    modal.classList.add('is-closing');
    modal.classList.remove('is-open');
    setTimeout(function () {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    }, 280);
  }

  function showSignupOffer(user, force) {
    if (!user || !user.id || inOfferPopupFrame()) return;
    if (!force && isSignupOfferDismissed(user)) return;
    if (document.getElementById('hansoraSignupOffer')) return;

    const modal = document.createElement('div');
    modal.id = 'hansoraSignupOffer';
    modal.className = 'hansora-offer-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Creator discount offer');
    modal.innerHTML = `
      <div class="hansora-offer-panel">
        <iframe class="hansora-offer-frame" src="${withAffiliateRef(SIGNUP_OFFER_URL)}" title="Hansora pricing offer"></iframe>
        <button class="hansora-offer-close" type="button" aria-label="Close offer">×</button>
      </div>`;
    document.body.appendChild(modal);

    const close = modal.querySelector('.hansora-offer-close');
    if (close) close.addEventListener('click', function () { closeSignupOffer(user); });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSignupOffer(user);
    });
    requestAnimationFrame(function () {
      modal.classList.add('is-open');
      if (close) close.focus({ preventScroll: true });
    });
  }

  function scheduleSignupOffer(user, forceNew) {
    if (!user || !user.id || inOfferPopupFrame()) return;
    if (forceNew) {
      try {
        localStorage.removeItem(offerDismissedKey(user));
        localStorage.removeItem(offerPendingKey(user));
      } catch (_) {}
    }
    if (isSignupOfferDismissed(user)) return;
    const key = offerPendingKey(user);
    if (!key) return;

    let deadline = 0;
    try {
      deadline = Number(localStorage.getItem(key) || 0);
      if (forceNew || !Number.isFinite(deadline) || deadline <= 0) {
        deadline = Date.now() + SIGNUP_OFFER_DELAY_MS;
        localStorage.setItem(key, String(deadline));
      }
    } catch (_) {
      deadline = Date.now() + SIGNUP_OFFER_DELAY_MS;
    }

    const wait = Math.max(0, deadline - Date.now());
    if (signupOfferTimer) clearTimeout(signupOfferTimer);
    signupOfferTimer = setTimeout(function () {
      showSignupOffer(user);
    }, wait);
  }

  function resumeSignupOffer(user) {
    if (!user || !user.id || inOfferPopupFrame() || isSignupOfferDismissed(user)) return;
    try {
      const deadline = Number(localStorage.getItem(offerPendingKey(user)) || 0);
      if (Number.isFinite(deadline) && deadline > 0) scheduleSignupOffer(user, false);
    } catch (_) {}
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
      btnGetStarted.addEventListener('click', function () {});
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
          captureAffiliateRef();
          const ref = getStoredAffiliateRef();
          if (ref) rememberAffiliateRef(ref, 'google_oauth');
          rememberSignupOfferOAuthStart();
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
          await registerAffiliateReferral(data.user);
          handleSignupOffer(data.user, profile);
          closeAuth();
        } catch (error) {
          if (msg) msg.textContent = error.message || 'Login failed.';
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        if (sb) await sb.auth.signOut();
        window.location.replace('/');
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
      await handleAuthenticatedUser(user);
    } catch (error) {
      console.warn('Hansora header session restore failed', error);
      showLoggedOutUI();
    }
  }

  async function handleAuthenticatedUser(user) {
    if (!user) return null;
    refreshAnalyticsAuthCache();
    const profile = await getOrCreateProfile(user);
    showLoggedInUI(profile, user);
    await registerAffiliateReferral(user);
    handleSignupOffer(user, profile);
    return profile;
  }

  function bindAuthStateChanges() {
    if (!sb || !sb.auth || typeof sb.auth.onAuthStateChange !== 'function') return;
    sb.auth.onAuthStateChange(function (event, session) {
      const user = session && session.user ? session.user : null;
      if (!user) {
        if (event === 'SIGNED_OUT') showLoggedOutUI();
        return;
      }
      setTimeout(function () {
        handleAuthenticatedUser(user).catch(function (error) {
          console.warn('Hansora auth state handling failed', error);
        });
      }, 0);
    });
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
      startCreditsPolling,
      showSignupOfferNow: function () {
        const user = currentUser || { id: 'debug' };
        showSignupOffer(user, true);
      },
      showPricingOfferNow: function () {
        const user = currentUser || { id: 'pricing-offer' };
        showSignupOffer(user, true);
      },
      resetSignupOffer: function () {
        const user = currentUser;
        if (!user || !user.id) return false;
        try {
          localStorage.removeItem(offerDismissedKey(user));
          localStorage.removeItem(offerPendingKey(user));
          localStorage.removeItem(SIGNUP_OFFER_OAUTH_STARTED_KEY);
        } catch (_) {}
        return true;
      }
    };
    window.refreshCredits = refreshCredits;
    window.hansoraCredits = { addCredits, useCredits, setCredits };
  }

  captureAffiliateRef();
  ensureI18nRuntime();

  ready(function () {
    captureAffiliateRef();
    applyTelegramViewportFix();
    injectHeaderStyles();
    injectHeader();
    injectAuthModal();
    ensureSupabaseClient();
    exposeApi();
    bindEvents();
    bindGlobalClickTracking();
    preserveAffiliateRefAcrossPageLinks();
    bindAuthStateChanges();
    restoreSession();
  });
})();
