// Hansora app additions. Loaded first on every page of the app (added by scripts/package-site.mjs).
// The pages themselves are the website's own files, unchanged. This file only adds what an app needs:
//  - talk to the same server (hansora.co functions) from inside the app
//  - Google/Telegram login through the phone's browser (they block logins inside apps)
//  - store rules: no website checkout inside the app
//  - a clear door between Creative and Automation
(function () {
  'use strict';
  var SITE = 'https://hansora.co';
  var CALLBACK = 'co.hansora.app://auth/callback';
  var RETURN_KEY = 'hansora.app.oauthReturn';
  var Cap = window.Capacitor;
  var native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var Plugins = (Cap && Cap.Plugins) || {};
  // The app's version: shown at the bottom of the menus, and printed by the update command, so we always know
  // which version a phone runs. Change it with every update.
  var HANSORA_BUILD = '2026.11.13-9';
  window.HANSORA_BUILD = HANSORA_BUILD;
  var root = document.documentElement;
  root.classList.add('hansora-app', 'hansora-app-' + (native ? Cap.getPlatform() : 'web'));

  // ---------- 0. No ad tracking inside the app (Apple App Tracking Transparency) ----------
  // Facebook Pixel and Google Ads track people across apps and websites, which needs Apple's permission prompt.
  // The app doesn't use them: their scripts never load and calls to them do nothing. Hansora's own anonymous
  // analytics (with its consent banner) stay as on the website.
  var TRACKERS = /^(https?:)?\/\/(connect\.facebook\.net|www\.googletagmanager\.com|www\.google-analytics\.com|googleads\.g\.doubleclick\.net)\//i;
  var srcProp = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    configurable: true, enumerable: srcProp.enumerable, get: srcProp.get,
    set: function (value) { if (TRACKERS.test(String(value))) { this.type = 'javascript/blocked'; return; } srcProp.set.call(this, value); }
  });
  var noop = function () {};
  window.fbq = noop; window._fbq = noop; window.gtag = noop;
  try { Object.defineProperty(window, 'fbq', { configurable: true, get: function () { return noop; }, set: function () {} }); } catch (_) {}

  // ---------- 1. Same server as the website ----------
  // Pages call "/.netlify/functions/…"; inside the app those live on hansora.co.
  function serverUrl(url) {
    if (!native) return url; // browser preview: the functions are on the same site
    var s = String(url);
    if (s.indexOf('/.netlify/') === 0) return SITE + s;
    if (s.indexOf(location.origin + '/.netlify/') === 0) return SITE + s.slice(location.origin.length);
    return url;
  }
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === 'string' || input instanceof URL) return nativeFetch.call(this, serverUrl(input), init);
    if (input && input.url && serverUrl(input.url) !== input.url) return nativeFetch.call(this, new Request(serverUrl(input.url), input), init);
    return nativeFetch.call(this, input, init);
  };
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = serverUrl(url);
    return open.apply(this, args);
  };
  // Sound and video from the server (e.g. the phone voice ▶ preview): /.netlify/… lives on hansora.co, not in the app.
  if (native) {
    var NativeAudio = window.Audio;
    if (NativeAudio) {
      window.Audio = function (src) { return arguments.length ? new NativeAudio(serverUrl(src)) : new NativeAudio(); };
      window.Audio.prototype = NativeAudio.prototype;
    }
    var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDesc && srcDesc.set) Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, enumerable: srcDesc.enumerable, get: srcDesc.get,
      set: function (value) { srcDesc.set.call(this, serverUrl(value)); }
    });
  }

  // ---------- 2. Login with Google / Telegram through the phone's browser ----------
  function wrapAuth(sb) {
    if (!sb || !sb.auth || sb.auth.__hansoraApp || !native) return sb;
    var original = sb.auth.signInWithOAuth.bind(sb.auth);
    sb.auth.signInWithOAuth = async function (args) {
      var options = Object.assign({}, args && args.options);
      try { localStorage.setItem(RETURN_KEY, options.redirectTo || location.href); } catch (_) {}
      options.redirectTo = CALLBACK;
      options.skipBrowserRedirect = true;
      var result = await original(Object.assign({}, args, { options: options }));
      if (!result.error && result.data && result.data.url && Plugins.Browser) await Plugins.Browser.open({ url: result.data.url, presentationStyle: 'popover' });
      return result;
    };
    sb.auth.__hansoraApp = true;
    return sb;
  }
  // header.js creates the website's client as window.__HANSORA_SB__.
  var client;
  try {
    Object.defineProperty(window, '__HANSORA_SB__', { configurable: true, get: function () { return client; }, set: function (v) { client = wrapAuth(v); } });
  } catch (_) {}

  if (native && Plugins.App) {
    Plugins.App.addListener('appUrlOpen', async function (event) {
      var url = String((event && event.url) || '');
      if (url.indexOf(CALLBACK) !== 0) return;
      try { if (Plugins.Browser) await Plugins.Browser.close(); } catch (_) {}
      // Supabase answers with ?code=… (PKCE) or #access_token=…&refresh_token=… (implicit), or an error.
      var parsed = new URL(url.replace('co.hansora.app://', 'https://app.invalid/'));
      var hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      var get = function (k) { return parsed.searchParams.get(k) || hash.get(k); };
      var failure = get('error_description') || get('error');
      if (failure) { alert('Login failed: ' + failure.replace(/\+/g, ' ')); return; }
      if (client) {
        var done = null;
        if (get('code')) done = await client.auth.exchangeCodeForSession(get('code'));
        else if (get('access_token') && get('refresh_token')) done = await client.auth.setSession({ access_token: get('access_token'), refresh_token: get('refresh_token') });
        if (done && done.error) { alert(done.error.message || 'Login failed'); return; }
      }
      var back = '/';
      try { back = localStorage.getItem(RETURN_KEY) || '/'; localStorage.removeItem(RETURN_KEY); } catch (_) {}
      // The website's return address points at hansora.co; inside the app, open the same page here.
      try { var u = new URL(back, location.href); back = u.pathname + u.search + u.hash; } catch (_) { back = '/'; }
      location.replace(back);
    });
  }

  // ---------- 3. Store rules: no website checkout inside the app ----------
  // Apple 3.1.1 / Google Play: credits can't be sold through Dodo/YooMoney inside an app.
  // Credits bought on the website still work in the app.
  // The pricing pages stay: their Buy buttons use Apple / Google in-app purchase (app/iap.js), never the website checkout.
  if (/russian-payment|\/affilate/i.test(location.pathname)) {
    location.replace('/');
    return;
  }
  // The website's old login page: the app has its own login screen.
  if (/^\/login(\.html)?$/i.test(location.pathname)) { location.replace('/app/login.html'); return; }

  // ---------- 4. App behaviour ----------
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    // No accidental zooming, like an app.
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) { viewport = document.createElement('meta'); viewport.name = 'viewport'; document.head.appendChild(viewport); }
    viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  });

  // Website links without ".html" (e.g. /policy) open the packaged page.
  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    var href = a.getAttribute('href') || '';
    if (/^https?:\/\/(www\.)?hansora\.co(\/|$)/i.test(href)) { a.setAttribute('href', href.replace(/^https?:\/\/(www\.)?hansora\.co/i, '') || '/'); href = a.getAttribute('href'); }
    var m = href.match(/^\/([a-z0-9_-]+)(\?[^#]*)?(#.*)?$/i);
    if (m && m[1] !== 'app') a.setAttribute('href', '/' + m[1] + '.html' + (m[2] || '') + (m[3] || ''));
  }, true);

  // ---------- 5. Delete account (Apple 5.1.1(v), Google Play) — on the Creative and Automation profile pages ----------
  function addDeleteAccount() {
    if (!/\/(automation-)?profile(\.html)?$/i.test(location.pathname) || document.getElementById('appDeleteAccount')) return;
    var main = document.querySelector('main');
    if (!main) return;
    var box = document.createElement('section');
    box.id = 'appDeleteAccount';
    box.className = 'app-delete';
    box.innerHTML = '<h2>Delete account</h2>' +
      '<p>Choose what to delete. We complete the deletion within 30 days.</p>' +
      '<button type="button" data-scope="automation">Delete my Automation data<small>AI employees, chats, contacts, orders and bookings. Your Hansora account and credits stay.</small></button>' +
      '<button type="button" data-scope="account" class="danger">Delete my whole Hansora account<small>Everything, including your creations and remaining credits. This can\'t be undone.</small></button>' +
      '<p class="app-delete-status" role="status"></p>';
    main.appendChild(box);
    box.addEventListener('click', async function (event) {
      var button = event.target.closest('button[data-scope]');
      if (!button) return;
      var scope = button.dataset.scope;
      var question = scope === 'account'
        ? 'Delete your whole Hansora account?\n\nYour creations and remaining credits will be deleted. This can\'t be undone.'
        : 'Delete your Automation data?\n\nYour AI employees, chats, contacts, orders and bookings will be deleted.';
      if (!window.confirm(question)) return;
      var status = box.querySelector('.app-delete-status');
      var sb = window.__HANSORA_SB__;
      var session = sb && (await sb.auth.getSession()).data.session;
      if (!session) { status.textContent = 'Please log in first.'; return; }
      box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      status.textContent = 'Sending…';
      try {
        var response = await fetch('/.netlify/functions/account-deletion-request', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
          body: JSON.stringify({ scope: scope })
        });
        if (!response.ok) throw new Error('request_failed');
        window.alert('Your request was received. We will delete ' + (scope === 'account' ? 'your Hansora account' : 'your Automation data') + ' within 30 days.');
        if (scope === 'account') { await sb.auth.signOut(); location.replace('/'); return; }
        status.textContent = 'Request received.';
      } catch (_) {
        status.textContent = 'Something went wrong. Please try again.';
        box.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      }
    });
  }
  onReady(addDeleteAccount);

  // Profile: the affiliate program earns from website purchases, so it isn't offered in the app.
  onReady(function () {
    document.querySelectorAll('span, h2, h3').forEach(function (el) {
      if (!/^\s*Affiliate program\s*$/i.test(el.textContent)) return;
      var card = el.closest('.overflow-hidden') || el.closest('section') || el.parentElement;
      if (card) card.setAttribute('data-app-hidden', '');
    });
  });

  // ---------- 6. Moving around like an app ----------
  // Page changes slide like a native app, done by the iPhone itself (MainViewController in AppDelegate.swift):
  // "leave" → a picture of this screen stays in front while the next page loads (never a black screen);
  // "ready" → the next page's picture slides in (Back: the old one slides away; bottom-bar tabs: a quick fade).
  // Swipe from the left edge goes back. Where the iPhone part is missing (Android, browser), pages switch at once.
  // Scroll position: coming back to a page (Back, or a bottom-bar tab) returns to where you were.
  var SLIDE_KEY = 'hansora.app.slide', SCROLL_KEY = 'hansora.app.scroll';
  var navEntry = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  var slide = null;
  try { slide = sessionStorage.getItem(SLIDE_KEY); sessionStorage.removeItem(SLIDE_KEY); } catch (_) {}
  var cameBack = slide === 'back' || navEntry.type === 'back_forward';
  function tellPhone(message) {
    try { var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraNav; if (h) { h.postMessage(message); return true; } } catch (_) {}
    return false;
  }
  // Back: the phone itself puts the page back where you were; the code below only helps when it didn't.
  // "/" and "/index.html" are the same page.
  var pageKey = function (href) { try { var u = new URL(href || location.href); var p = u.pathname === '/' ? '/index.html' : u.pathname; return p + u.search; } catch (_) { return location.pathname; } };
  function readScrolls() { try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); } catch (_) { return {}; } }
  function saveScroll() { try { var all = readScrolls(); all[pageKey()] = Math.round(window.scrollY || 0); sessionStorage.setItem(SCROLL_KEY, JSON.stringify(all)); } catch (_) {} }
  var scrollTimer = null;
  window.addEventListener('scroll', function () { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveScroll, 150); }, { passive: true });
  window.addEventListener('pagehide', saveScroll);
  var isMainTab = /^\/(index\.html)?$|^\/(search-models|usage|models|automation-dashboard|automation-agent|automation-inbox|automation)\.html$/i.test(location.pathname);
  var wantY = (cameBack || (slide && isMainTab)) ? readScrolls()[pageKey()] : 0;
  // Tell the phone the page is ready (after the scroll position is back, so the picture shows the right place).
  var readySent = false;
  function sendReady() { if (readySent) return; readySent = true; requestAnimationFrame(function () { requestAnimationFrame(function () { tellPhone({ phase: 'ready' }); }); }); }
  if (wantY > 0) {
    var stop = false, started = Date.now();
    // Coming back: give the phone's own restore a moment first.
    var stopIt = function () { stop = true; };
    window.addEventListener('touchstart', stopIt, { passive: true, once: true });
    var restore = function () {
      if (stop) return sendReady();
      var max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(wantY, Math.max(0, max)));
      if (Math.abs(window.scrollY - wantY) <= 4 || Date.now() - started > 2500) { stop = true; return sendReady(); }
      setTimeout(restore, 100); // the page is still growing (sections loading)
      if (Date.now() - started > 700) sendReady(); // don't hold the picture longer than this
    };
    onReady(function () { setTimeout(function () {
      if (cameBack && Math.abs(window.scrollY - wantY) <= 40) { stop = true; return sendReady(); } // the phone did it
      restore();
    }, cameBack ? 120 : 0); });
  } else {
    onReady(function () { setTimeout(sendReady, 30); });
  }
  // A page kept in memory (Back): it is ready straight away.
  window.addEventListener('pageshow', function (event) { if (event.persisted) { readySent = false; sendReady(); } });
  var hideSplash = function () { try { if (native && Plugins.SplashScreen) Plugins.SplashScreen.hide({ fadeOutDuration: 250 }); } catch (_) {} };
  onReady(function () { setTimeout(hideSplash, 80); });
  // kind: "push" (a link), "back", or "tab" (bottom bar).
  window.HansoraLeave = function (go, back, kind) {
    saveScroll();
    try { sessionStorage.setItem(SLIDE_KEY, back ? 'back' : 'forward'); } catch (_) {}
    // The iPhone takes a picture of this screen first, then answers "go" (window.__hansoraGo); at most 0.6 s.
    var went = false;
    var goOnce = function () { if (went) return; went = true; window.__hansoraGo = null; go(); };
    window.__hansoraGo = goOnce;
    if (tellPhone({ phase: 'leave', kind: back ? 'back' : (kind || 'push') })) setTimeout(goOnce, 600); else goOnce();
  };
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var raw = a.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#' || /^(javascript|mailto|tel|sms):/i.test(raw)) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin) return;
    if (pageKey(url.href) === pageKey()) return; // same page
    event.preventDefault();
    var tab = !!a.closest('.hs-bottom-nav, .auto-bottom-nav');
    window.HansoraLeave(function () { location.href = url.href; }, false, tab ? 'tab' : 'push');
  });

  // Logged out: links to signed-in Automation pages go straight to the login screen (no page that appears and
  // then jumps to login). "Start free setup" opens "Create account".
  var SIGNED_IN_PAGES = /^\/automation-(setup|dashboard|agent|inbox|operations|products|tools|phone|usage|profile|contacts|comments|workflows|connect|tiktok-comments)(\.html)?$/i;
  function hasSession() {
    try {
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (/^sb-.*-auth-token$/.test(key)) { var v = JSON.parse(localStorage.getItem(key) || 'null'); if (v && (v.access_token || (v.currentSession && v.currentSession.access_token))) return true; }
      }
    } catch (_) {}
    return false;
  }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    var url; try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin || !SIGNED_IN_PAGES.test(url.pathname) || url.searchParams.get('preview') === '1' || hasSession()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var q = new URLSearchParams({ returnTo: url.pathname + url.search });
    if (/automation-setup/i.test(url.pathname)) q.set('mode', 'signup');
    window.HansoraLeave(function () { location.href = '/app/login.html?' + q; }, false);
  }, true);

  // Only this harmless notice is ignored (a page slide interrupted by a page that moves on straight away).
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason && reason.name === 'InvalidStateError' && /Transition was aborted|ViewTransition/i.test(String(reason.message))) event.preventDefault();
  });

  // Back arrow on inner pages. Main pages (the bottom-bar tabs) have none, like an app.
  var MAIN_PAGES = /^\/(index\.html)?$|^\/(search-models|usage|automation-dashboard|automation-agent|automation-inbox|automation)\.html$/i;
  function addBackButton() {
    if (MAIN_PAGES.test(location.pathname) || /^\/app\//.test(location.pathname) || document.querySelector('.app-back-btn')) return;
    var brand = document.querySelector('.site-header .brand, .auto-header .auto-brand');
    if (!brand) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-back-btn';
    button.setAttribute('aria-label', 'Back');
    button.textContent = '‹';
    button.addEventListener('click', function () {
      // Back to the page you came from (all pages in the app's history are the app's own pages).
      var go = history.length > 1 ? function () { history.back(); } : function () { location.href = isAutomation ? '/automation-dashboard.html' : '/index.html'; };
      if (window.HansoraLeave) window.HansoraLeave(go, true); else go();
    });
    brand.parentNode.insertBefore(button, brand);
  }
  onReady(addBackButton);
  new MutationObserver(addBackButton).observe(root, { childList: true, subtree: true });

  // Pull down to refresh (only when the page is at the very top and nothing else is being scrolled).
  (function () {
    var startY = 0, pulling = false, distance = 0, indicator = null;
    function scrolledInside(el) { for (; el && el !== document.body; el = el.parentElement) { if (el.scrollTop > 0) return true; } return false; }
    document.addEventListener('touchstart', function (event) {
      pulling = window.scrollY <= 0 && event.touches.length === 1 && !scrolledInside(event.target) && !document.querySelector('.is-open, .menu-open, [aria-modal="true"]:not([hidden])');
      startY = event.touches[0].clientY; distance = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (event) {
      if (!pulling) return;
      distance = event.touches[0].clientY - startY;
      if (distance <= 0) return;
      if (!indicator) { indicator = document.createElement('div'); indicator.className = 'app-ptr'; indicator.textContent = '↻'; document.body.appendChild(indicator); }
      var shown = Math.min(distance, 140) / 140;
      indicator.style.transition = 'none';
      indicator.style.transform = 'translateY(' + (-70 + shown * 90) + 'px) rotate(' + (shown * 270) + 'deg)';
      indicator.classList.toggle('ready', distance > 110);
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!pulling || !indicator) { pulling = false; return; }
      pulling = false;
      if (distance > 110) { indicator.style.transition = ''; indicator.style.transform = 'translateY(20px)'; indicator.classList.add('spin'); setTimeout(function () { location.reload(); }, 250); }
      else { indicator.style.transition = ''; indicator.style.transform = 'translateY(-70px)'; }
    }, { passive: true });
  })();

  // App wording: "Click" -> "Tap", and Hansora's own "website" -> "app". Not on legal pages, and never inside
  // chats, contacts, products or anything people type (a business's own website stays a website).
  var LEGAL = /(policy|termsofuse|privacy|terms|data-deletion)\.html$/i;
  var WORDING = [
    [/\bDouble-click\b/g, 'Double-tap'], [/\bdouble-click\b/g, 'double-tap'],
    [/\bClick(ing|ed)?\b/g, function (m, end) { return 'Tap' + (end === 'ing' ? 'ping' : end === 'ed' ? 'ped' : ''); }],
    [/\bclick(ing|ed)?\b/g, function (m, end) { return 'tap' + (end === 'ing' ? 'ping' : end === 'ed' ? 'ped' : ''); }],
    [/\b(the )?same prices as (on )?the website\b/gi, 'the same prices as in the app'],
    [/\bthe same as on the website\b/gi, 'the same as in the app'],
    [/\bHansora website\b/g, 'Hansora app'], [/\b(on|in) our website\b/gi, '$1 our app'], [/\bthis website\b/gi, 'this app']
  ];
  var KEEP = 'input, textarea, select, script, style, [contenteditable], .ui-convo, .ui-thread, .ui-messages, .ui-message, .ui-contact-list, .ui-record-row, [data-app-keep-text]';
  function appWording(rootNode) {
    if (LEGAL.test(location.pathname) || !rootNode) return;
    var walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      if (!text || !/click|website/i.test(text)) continue;
      var parent = node.parentElement;
      if (!parent || parent.closest(KEEP)) continue;
      var next = text;
      WORDING.forEach(function (rule) { next = next.replace(rule[0], rule[1]); });
      if (next !== text) node.nodeValue = next;
    }
  }
  onReady(function () {
    appWording(document.body);
    new MutationObserver(function (changes) {
      changes.forEach(function (c) { c.addedNodes.forEach(function (n) { if (n.nodeType === 1) appWording(n); else if (n.nodeType === 3 && n.parentNode) appWording(n.parentNode); }); });
    }).observe(document.body, { childList: true, subtree: true });
  });

  // Models page: clear names for the settings.
  if (/search-models/i.test(location.pathname)) onReady(function () {
    [['#resolutionBlock > span', 'Quality'], ['#aspectBlock > span', 'Aspect ratio']].forEach(function (pair) {
      var label = document.querySelector(pair[0]); if (label && label.children.length === 0) label.textContent = pair[1];
    });
  });

  // Automation: "Home" opens the Automation home page (what it is, how it works), like the logo does.
  if (/^\/automation/i.test(location.pathname)) {
    var fixHome = function () {
      var home = document.querySelector('.auto-bottom-nav a.auto-tab');
      if (home && home.getAttribute('href') !== '/automation.html') home.setAttribute('href', '/automation.html');
      var brand = document.querySelector('.auto-brand');
      if (brand && brand.getAttribute('href') !== '/automation.html') brand.setAttribute('href', '/automation.html');
    };
    onReady(fixHome);
    new MutationObserver(fixHome).observe(root, { childList: true, subtree: true });
  }
  // Setup: people who only want comment automations (or just to look around) can skip creating an AI employee.
  if (/automation-setup/i.test(location.pathname)) onReady(function () {
    var main = document.querySelector('main');
    if (!main || document.querySelector('.app-skip')) return;
    var skip = document.createElement('a');
    skip.className = 'app-skip'; skip.href = '/automation-dashboard.html';
    skip.innerHTML = '<span>Not now</span><b>Skip and open my account →</b>';
    main.insertBefore(skip, main.firstChild);
  });

  // Section name in the middle of the app's top bar.
  function addTitle() {
    var bar = document.querySelector('#siteHeader .shell.nav, .auto-header');
    if (!bar || bar.querySelector('.app-title')) return;
    var title = document.createElement('span');
    title.className = 'app-title';
    title.textContent = isAutomation ? 'Automation' : 'Creative';
    bar.appendChild(title);
  }
  onReady(addTitle);
  new MutationObserver(addTitle).observe(root, { childList: true, subtree: true });

  // ---------- 8. Saving creations: the phone's share sheet (Save Image / Save Video, AirDrop, apps) ----------
  // Inside an iPhone app the website's download buttons do nothing, so the app downloads the file itself
  // and opens the share sheet. Only in the installed app; the website is unchanged.
  if (native && Plugins.Filesystem && Plugins.Share) {
    var saving = false;
    var extFrom = function (name, type) {
      var m = String(name || '').match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
      if (m) return m[1].toLowerCase();
      return /video/.test(type) ? 'mp4' : /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : /audio|mpeg/.test(type) ? 'mp3' : 'jpg';
    };
    var blobToBase64 = function (blob) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(String(r.result).split(',')[1] || ''); }; r.onerror = reject; r.readAsDataURL(blob); }); };
    window.HansoraSave = async function (href, filename) {
      if (saving) return; saving = true;
      try {
        var name = 'hansora-' + Date.now();
        var target;
        if (/^(blob|data):/i.test(href)) {
          var blob = await (await (window.CapacitorWebFetch || nativeFetch)(href)).blob();
          name += '.' + extFrom(filename, blob.type);
          target = await Plugins.Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: 'CACHE' });
        } else {
          var url = new URL(href, location.href).href;
          // The website's download helper (/.netlify/functions/download-proxy?url=…&name=…): fetch the file itself.
          var parsed = new URL(url);
          if (/\/\.netlify\/functions\/download-proxy$/.test(parsed.pathname) && parsed.searchParams.get('url')) {
            filename = filename || parsed.searchParams.get('name');
            url = new URL(parsed.searchParams.get('url'), SITE).href;
          } else {
            url = serverUrl(url); // other server addresses live on hansora.co, not inside the app
          }
          name += '.' + extFrom(filename || url, '');
          var where = await Plugins.Filesystem.getUri({ path: name, directory: 'CACHE' });
          if (Plugins.FileTransfer) { await Plugins.FileTransfer.downloadFile({ url: url, path: where.uri }); target = where; }
          else { var b = await (await nativeFetch(url)).blob(); target = await Plugins.Filesystem.writeFile({ path: name, data: await blobToBase64(b), directory: 'CACHE' }); }
        }
        await Plugins.Share.share({ files: [target.uri] });
      } catch (error) {
        if (!/cancel/i.test(String(error && error.message))) alert('Could not save the file. Please try again.');
      } finally { saving = false; }
    };
    var isDownload = function (a) { return a && a.hasAttribute && a.hasAttribute('download') && a.getAttribute('href'); };
    document.addEventListener('click', function (event) {
      var a = event.target && event.target.closest ? event.target.closest('a[download]') : null;
      if (!isDownload(a)) return;
      event.preventDefault(); event.stopPropagation();
      window.HansoraSave(a.href, a.getAttribute('download'));
    }, true);
    // Pages that create a hidden download link and click it from code.
    var anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (isDownload(this)) return window.HansoraSave(this.href, this.getAttribute('download'));
      return anchorClick.apply(this, arguments);
    };
  }

  // ---------- 9. No internet: a clear app message instead of broken pages ----------
  (function () {
    var bar = null;
    function update() {
      var offline = navigator.onLine === false;
      if (offline && !bar) {
        bar = document.createElement('div'); bar.className = 'app-offline'; bar.setAttribute('role', 'status');
        bar.innerHTML = '<b>No internet connection</b><span>Hansora needs the internet. Check your connection.</span><button type="button">Try again</button>';
        bar.querySelector('button').addEventListener('click', function () { location.reload(); });
        (document.body || root).appendChild(bar);
      } else if (!offline && bar) { bar.remove(); bar = null; }
    }
    window.addEventListener('offline', update); window.addEventListener('online', update);
    onReady(update);
  })();

  // ---------- 7. Doors between Creative and Automation ----------
  var isAutomation = /^\/automation/i.test(location.pathname);
  function addDoors() {
    // Creative: top of the bottom-bar Menu.
    var links = document.querySelector('#hs-overlay .links');
    if (links && !links.querySelector('.app-door')) {
      var a = document.createElement('a');
      a.className = 'app-door automation';
      a.href = '/automation.html';
      a.innerHTML = '<em aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg></em><span><b>Hansora Automation</b><small>Your AI employee: chats, orders, bookings</small></span><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></i>';
      links.insertBefore(a, links.firstChild);
      // The footer's Terms and Privacy links, at the end of the menu (footers are hidden in the app).
      [['/termsofuse.html', 'Terms of use'], ['/policy.html', 'Privacy policy']].forEach(function (item) {
        if (links.querySelector('a[href="' + item[0] + '"]')) return;
        var link = document.createElement('a');
        link.href = item[0];
        link.className = 'app-legal';
        link.textContent = item[1];
        links.appendChild(link);
      });
    }
  }
  // Automation: the same kind of door, back to Creative, at the top of its Menu.
  function addCreativeDoor() {
    var nav = document.getElementById('automation-nav');
    if (!nav || nav.querySelector('.app-door')) return;
    var a = document.createElement('a');
    a.className = 'app-door creative';
    a.href = '/index.html';
    a.innerHTML = '<em aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></em><span><b>Hansora Creative</b><small>Images, videos, audio &amp; more</small></span><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></i>';
    nav.insertBefore(a, nav.firstChild);
  }
  // Creative: the small profile menu (photo) also opens Automation.
  function addProfileMenuDoor() {
    var menu = document.getElementById('navMenu');
    if (!menu || isAutomation || menu.querySelector('.app-menu-automation')) return;
    var a = document.createElement('a');
    a.className = 'app-menu-automation'; a.href = '/automation.html';
    a.innerHTML = '<span>Hansora Automation</span><i aria-hidden="true">→</i>';
    var logout = document.getElementById('btnLogout');
    menu.insertBefore(a, logout || null);
  }
  onReady(addProfileMenuDoor);
  new MutationObserver(addProfileMenuDoor).observe(root, { childList: true, subtree: true });
  // Automation pages whose header has no account area (the Automation home): the profile photo, like everywhere else.
  function addAutomationAvatar() {
    if (!isAutomation) return;
    var tools = document.querySelector('.auto-header .auto-header-tools');
    var avatar = document.getElementById('navAvatar'), img = document.getElementById('navAvatarImg');
    if (!tools || !avatar || tools.querySelector('.auto-account')) return;
    var mine = tools.querySelector('.app-hdr-avatar');
    var loggedIn = avatar.style.display !== 'none' && getComputedStyle(avatar).display !== 'none' || hasSession();
    if (!loggedIn) { if (mine) mine.remove(); return; }
    if (!mine) {
      mine = document.createElement('button');
      mine.type = 'button'; mine.className = 'app-hdr-avatar'; mine.setAttribute('aria-label', 'Open account menu');
      mine.innerHTML = '<img alt="">';
      mine.addEventListener('click', function (event) { event.stopPropagation(); avatar.click(); });
      tools.insertBefore(mine, tools.querySelector('.auto-menu-toggle'));
    }
    var src = img && img.getAttribute('src');
    if (src && mine.firstChild.getAttribute('src') !== src) mine.firstChild.setAttribute('src', src);
  }
  onReady(addAutomationAvatar);
  if (isAutomation) setInterval(addAutomationAvatar, 1200); // login state and photo can change after the page opens
  // The ⚡ credits number in the top bar opens the pricing page of the section you are in.
  document.addEventListener('click', function (event) {
    var pill = event.target && event.target.closest ? event.target.closest('#navCredits, .credits-pill, .auto-credits') : null;
    if (!pill) return;
    event.preventDefault();
    var to = isAutomation ? '/automation-pricing.html' : '/pricing.html';
    if (location.pathname !== to) window.HansoraLeave(function () { location.href = to; }, false);
  });
  // Version line at the bottom of both menus ("slide ✓" when the iPhone part for page slides is there).
  function addVersion() {
    var host = document.querySelector('#hs-overlay .links') || document.getElementById('automation-nav');
    if (!host || host.querySelector('.app-version')) return;
    var slideOn = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraNav);
    var p = document.createElement('p');
    p.className = 'app-version';
    p.textContent = 'Hansora app · version ' + HANSORA_BUILD + (native ? (slideOn ? ' · slide ✓' : ' · slide ✗') : '');
    host.appendChild(p);
  }
  onReady(addVersion);
  new MutationObserver(addVersion).observe(root, { childList: true, subtree: true });
  var addAnyDoor = isAutomation ? addCreativeDoor : addDoors;
  onReady(addAnyDoor);
  new MutationObserver(addAnyDoor).observe(root, { childList: true, subtree: true });

  // Report content (Google Play's AI-generated content policy; Apple 1.2): a "Report content" entry in both menus opens a
  // short form inside the app. It is sent to Hansora support through the website's contact form.
  function openReport() {
    if (document.getElementById('appReport')) return;
    var box = document.createElement('div');
    box.id = 'appReport'; box.className = 'app-report';
    box.innerHTML = '<form class="app-report-card" novalidate><h2>Report content</h2>' +
      '<p>Tell us about an AI result or anything in the app that is offensive, harmful or breaks the rules. We review every report.</p>' +
      '<label>Reason<select name="reason"><option>Offensive or hateful</option><option>Sexual content</option><option>Violence or harm</option><option>Copyright or someone else’s likeness</option><option>Other</option></select></label>' +
      '<label>What happened<textarea name="details" rows="4" placeholder="Which result (prompt, model, time) and what is wrong with it"></textarea></label>' +
      '<label>Your email<input name="email" type="email" autocomplete="email" placeholder="you@example.com"></label>' +
      '<p class="app-report-msg" role="status"></p>' +
      '<div class="app-report-actions"><button type="button" class="app-report-cancel">Cancel</button><button type="submit" class="app-report-send">Send report</button></div></form>';
    document.body.appendChild(box);
    var form = box.querySelector('form'), msg = box.querySelector('.app-report-msg');
    function close() { box.remove(); }
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    box.querySelector('.app-report-cancel').addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.email.value.trim(), details = form.details.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = 'Enter your email so we can reply.'; return; }
      if (details.length < 5) { msg.textContent = 'Describe what you are reporting.'; return; }
      var send = box.querySelector('.app-report-send'); send.disabled = true; msg.textContent = 'Sending…';
      var text = '[APP REPORT] ' + form.reason.value + '\n\n' + details + '\n\nPage: ' + location.pathname + location.search + '\nApp version: ' + HANSORA_BUILD;
      fetch('/.netlify/functions/contact-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, message: text }) })
        .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); form.innerHTML = '<h2>Thank you</h2><p>Your report was sent. We review it and remove content that breaks the rules.</p><div class="app-report-actions"><button type="button" class="app-report-send">Close</button></div>'; form.querySelector('button').addEventListener('click', close); })
        .catch(function () { send.disabled = false; msg.textContent = 'Could not send. Check your connection and try again.'; });
    });
  }
  function addReportLink() {
    var hosts = [document.querySelector('#hs-overlay .links'), document.getElementById('automation-nav'), document.getElementById('navMenu')];
    hosts.forEach(function (host) {
      if (!host || host.querySelector('.app-report-link')) return;
      var a = document.createElement('a');
      a.href = '#'; a.className = 'app-report-link'; a.textContent = 'Report content';
      a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openReport(); });
      var before = host.querySelector('.app-version') || (host.id === 'navMenu' ? document.getElementById('btnLogout') : null);
      host.insertBefore(a, before && before.parentNode === host ? before : null);
    });
  }
  onReady(addReportLink);
  new MutationObserver(addReportLink).observe(root, { childList: true, subtree: true });

  // Creative monthly plans are not sold in the app: the Creative pricing page always stays on credit packs.
  if (/^\/pricing(\.html)?$/.test(location.pathname)) {
    var keepPayg = function () { if (root.getAttribute('data-pricing-plan-mode') === 'monthly') root.setAttribute('data-pricing-plan-mode', 'payg'); };
    keepPayg();
    new MutationObserver(keepPayg).observe(root, { attributes: true, attributeFilter: ['data-pricing-plan-mode'] });
  }

  // Sign in with Apple (Apple 4.8: required next to Google sign-in). iPhone only: Apple's own sheet (AppDelegate.swift,
  // "hansoraApple"), then Supabase signs in with Apple's identity token.
  function addAppleButton() {
    var apple = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraApple;
    var google = document.getElementById('btnGoogle');
    if (!apple || !google || document.getElementById('btnApple')) return;
    var btn = document.createElement('button');
    btn.id = 'btnApple'; btn.type = 'button'; btn.className = 'app-apple-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M16.37 12.7c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.15.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.67zM14.1 5.94c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.75-.96 2.79 1.02.08 2.05-.52 2.68-1.27z"/></svg><span>Continue with Apple</span>';
    google.parentNode.insertBefore(btn, google);
    var errBox = function (text) { var e = document.getElementById('err') || document.querySelector('[id*="err"]'); if (e) e.textContent = text; else alert(text); };
    btn.addEventListener('click', function () { nativeApple(btn); });
  }
  async function nativeApple(btn) {
    var apple = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraApple;
    var errBox = function (text) { var e = document.getElementById('err') || document.getElementById('authError'); if (e) e.textContent = text; else alert(text); };
    if (!apple) return;
      try {
        var raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        var hashed = Array.from(new Uint8Array(digest), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        btn.disabled = true;
        window.__hansoraAppleDone = async function (res) {
          btn.disabled = false;
          if (!res || res.error) { if (res && res.error !== 'cancelled') errBox('Apple sign-in failed. Please try again.'); return; }
          var sb = window.__HANSORA_SB__;
          if (!sb) { errBox('Please try again in a moment.'); return; }
          var out = await sb.auth.signInWithIdToken({ provider: 'apple', token: res.token, nonce: raw });
          if (out.error) { errBox(out.error.message || 'Apple sign-in failed.'); return; }
          var name = [res.givenName, res.familyName].filter(Boolean).join(' ');
          if (name) { try { await sb.auth.updateUser({ data: { full_name: name, name: name } }); } catch (_) {} }
          var back = new URLSearchParams(location.search).get('returnTo') || '/index.html';
          if (!/^\/[^/]/.test(back)) back = '/index.html';
          location.href = back;
        };
        apple.postMessage({ nonce: hashed });
      } catch (e) { btn.disabled = false; errBox('Apple sign-in failed. Please try again.'); }
  }
  // The website's login window has its own Apple button (web sign-in, needs a server secret): in the iPhone app it uses
  // the same native Apple sheet instead.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#btnAppleLogin');
    if (!b || !(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraApple)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    nativeApple(b);
  }, true);
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hansoraApple) window.__hansoraNativeApple = nativeApple;
  onReady(addAppleButton);
  new MutationObserver(addAppleButton).observe(root, { childList: true, subtree: true });
})();

