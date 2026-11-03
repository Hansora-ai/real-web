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
  if (/(^|\/)(automation-)?pricing(_ru|_arm)?(\.html)?$/i.test(location.pathname) || /russian-payment|\/affilate/i.test(location.pathname)) {
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
  // Slide direction: going back slides the other way.
  window.addEventListener('pagereveal', function (event) {
    if (event.viewTransition) {
      root.classList.add('app-vt');
      // A page that sends you straight on (e.g. to the login screen) interrupts the slide; that's fine.
      ['ready', 'finished', 'updateCallbackDone'].forEach(function (key) { var promise = event.viewTransition[key]; if (promise && promise.catch) promise.catch(function () {}); });
    }
    var type = window.navigation && window.navigation.activation && window.navigation.activation.navigationType;
    root.classList.toggle('app-going-back', type === 'traverse');
  });

  // Only this harmless notice is ignored (a slide interrupted by a page that moves on straight away).
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason && reason.name === 'InvalidStateError' && /Transition was aborted|ViewTransition/i.test(String(reason.message))) event.preventDefault();
  });
  window.addEventListener('pageswap', function (event) {
    var vt = event.viewTransition;
    if (vt) ['ready', 'finished', 'updateCallbackDone'].forEach(function (key) { if (vt[key] && vt[key].catch) vt[key].catch(function () {}); });
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
      var cameFromApp = document.referrer && document.referrer.indexOf(location.origin) === 0;
      if (cameFromApp && history.length > 1) history.back();
      else location.href = isAutomation ? '/automation-dashboard.html' : '/index.html';
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
  var addAnyDoor = isAutomation ? addCreativeDoor : addDoors;
  onReady(addAnyDoor);
  new MutationObserver(addAnyDoor).observe(root, { childList: true, subtree: true });
})();
