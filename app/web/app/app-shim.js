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
      var code = new URL(url.replace('co.hansora.app://', 'https://app.invalid/')).searchParams.get('code');
      if (code && client) {
        var done = await client.auth.exchangeCodeForSession(code);
        if (done.error) { alert(done.error.message || 'Login failed'); return; }
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
  if (/(^|\/)(automation-)?pricing(_ru|_arm)?(\.html)?$/i.test(location.pathname) || /russian-payment/i.test(location.pathname)) {
    location.replace('/');
    return;
  }

  // ---------- 4. App behaviour ----------
  function onReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    // No accidental zooming, like an app.
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) { viewport = document.createElement('meta'); viewport.name = 'viewport'; document.head.appendChild(viewport); }
    viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
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

  // ---------- 5. Delete account (Apple 5.1.1(v), Google Play) — on the profile page ----------
  function addDeleteAccount() {
    if (!/\/profile(\.html)?$/i.test(location.pathname) || document.getElementById('appDeleteAccount')) return;
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

  // ---------- 6. Doors between Creative and Automation ----------
  var isAutomation = /^\/automation/i.test(location.pathname);
  function addDoors() {
    // Creative: top of the bottom-bar Menu.
    var links = document.querySelector('#hs-overlay .links');
    if (links && !links.querySelector('.app-door')) {
      var a = document.createElement('a');
      a.className = 'app-door automation';
      a.href = '/automation-dashboard.html';
      a.innerHTML = '<span><b>Hansora Automation</b><small>Your AI employee: chats, orders, bookings</small></span><i>→</i>';
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
  if (!isAutomation) {
    onReady(addDoors);
    new MutationObserver(addDoors).observe(root, { childList: true, subtree: true });
  }
})();
