// Buying credits and monthly plans inside the app: Apple App Store on iPhone, Google Play on Android, through
// RevenueCat. Same packs, plans and credits as the website. The server (revenuecat-webhook) adds the credits and plans
// to the same account, so they work in Creative and Automation, exactly like a website purchase.
// Loaded on the two pricing pages (pricing.html, automation-pricing.html).
(function () {
  'use strict';
  var Cap = window.Capacitor;
  var native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var platform = native ? Cap.getPlatform() : 'web';
  var Purchases = native && Cap.Plugins ? Cap.Plugins.Purchases : null;
  // RevenueCat public app keys (made to be inside apps; they can't spend money or read data). Set in iap-config.js.
  var KEYS = window.HANSORA_IAP_KEYS || {};
  var key = platform === 'ios' ? KEYS.ios : platform === 'android' ? KEYS.android : '';

  // Store product IDs: the same in App Store Connect, Google Play and the server (lib/business/app-purchases.mjs).
  var PACKS = { 90: 'co.hansora.app.credits.900', 200: 'co.hansora.app.credits.2000', 510: 'co.hansora.app.credits.5100', 1050: 'co.hansora.app.credits.10500' };
  var AUTOMATION_PACKS = { starter: 90, growth: 200, business: 510, scale: 1050 };
  var PLANS = {
    premium_monthly: 'co.hansora.app.creative.premium.monthly',
    pro_monthly: 'co.hansora.app.creative.pro.monthly',
    pro_max_monthly: 'co.hansora.app.creative.promax.monthly',
    automation_starter_monthly: 'co.hansora.app.automation.starter.monthly',
    automation_growth_monthly: 'co.hansora.app.automation.growth.monthly',
    automation_business_monthly: 'co.hansora.app.automation.business.monthly',
    automation_scale_monthly: 'co.hansora.app.automation.scale.monthly'
  };
  var storeName = platform === 'android' ? 'Google Play' : 'the App Store';

  function message(text) { try { (window.HansoraUI && window.HansoraUI.toast) ? window.HansoraUI.toast(text, 'info') : alert(text); } catch (_) { alert(text); } }
  function sb() { return window.__HANSORA_SB__ || null; }
  async function signedInUser() {
    var client = sb(); if (!client) return null;
    try { var r = await client.auth.getSession(); return r && r.data && r.data.session ? r.data.session.user : null; } catch (_) { return null; }
  }
  function goLogin() { location.href = '/app/login.html?' + new URLSearchParams({ returnTo: location.pathname + location.search }); }

  var configuredFor = null;
  async function ready(user) {
    if (!Purchases) throw Object.assign(new Error('Purchases work in the Hansora app from the App Store or Google Play.'), { friendly: true });
    if (!key) throw Object.assign(new Error('Purchases are not set up yet. Please try again soon.'), { friendly: true });
    if (configuredFor === user.id) return;
    var done = false;
    try { done = (await Purchases.isConfigured()).isConfigured; } catch (_) {}
    if (!done) await Purchases.configure({ apiKey: key, appUserID: user.id });
    else {
      var current = ''; try { current = (await Purchases.getAppUserID()).appUserID; } catch (_) {}
      if (current !== user.id) await Purchases.logIn({ appUserID: user.id });
    }
    try { if (user.email) await Purchases.setEmail({ email: user.email }); } catch (_) {}
    configuredFor = user.id;
  }
  async function storeProduct(id, subscription) {
    var r = await Purchases.getProducts({ productIdentifiers: [id], type: subscription ? 'SUBSCRIPTION' : 'NON_SUBSCRIPTION' });
    var list = (r && r.products) || [];
    return list.find(function (p) { return p.identifier === id || String(p.identifier).split(':')[0] === id; }) || null;
  }

  // A plan bought on the website stays the person's plan: don't sell a second one of the same kind.
  async function websitePlan(planId) {
    var client = sb(); var user = await signedInUser(); if (!client || !user) return null;
    var automation = /^automation_/.test(planId);
    try {
      var q = (automation ? client.schema('automation') : client).from(automation ? 'automation_subscriptions' : 'user_subscriptions')
        .select('plan_id,status,provider,current_period_end').eq('user_id', user.id).maybeSingle();
      var r = await q; var row = r && r.data;
      if (!row || row.status !== 'active' || /^(apple|google)$/.test(row.provider || '')) return null;
      if (row.current_period_end && Date.parse(row.current_period_end) < Date.now()) return null;
      return row;
    } catch (_) { return null; }
  }

  var busy = false;
  async function buy(id, subscription, button) {
    if (busy) return; busy = true;
    var label = button && button.textContent;
    try {
      var user = await signedInUser();
      if (!user) { goLogin(); return; }
      if (subscription) {
        var planId = Object.keys(PLANS).find(function (k) { return PLANS[k] === id; });
        var current = await websitePlan(planId);
        if (current) { message('You already have a monthly plan. To change it, cancel the current one first, then choose a new plan.'); return; }
      }
      await ready(user);
      if (button) { button.setAttribute('aria-busy', 'true'); button.textContent = 'Opening ' + (platform === 'android' ? 'Google Play' : 'App Store') + '…'; }
      var product = await storeProduct(id, subscription);
      if (!product) { message('This package is not available in ' + storeName + ' yet.'); return; }
      await Purchases.purchaseStoreProduct({ product: product });
      message(subscription ? 'Thank you! Your plan is active and the credits are being added.' : 'Thank you! Your credits are being added.');
      waitForCredits();
    } catch (error) {
      var cancelled = error && (error.userCancelled || String(error.code) === '1' || /cancel/i.test(String(error.message)));
      if (!cancelled) message(error && error.friendly ? error.message : 'The purchase did not go through. Nothing was charged. Please try again.');
    } finally {
      busy = false;
      if (button) { button.removeAttribute('aria-busy'); if (label) button.textContent = label; }
    }
  }

  // The store tells the server; the new balance shows once it arrives (usually a few seconds).
  async function waitForCredits() {
    var client = sb(); var user = await signedInUser(); if (!client || !user) return;
    var start = null;
    for (var i = 0; i < 15; i++) {
      try {
        var r = await client.from('profiles').select('credits').eq('user_id', user.id).maybeSingle();
        var credits = r && r.data ? Number(r.data.credits) : null;
        if (start === null) start = credits; else if (credits !== null && credits !== start) { setTimeout(function () { location.reload(); }, 600); return; }
      } catch (_) {}
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    }
  }

  async function restore() {
    try {
      var user = await signedInUser(); if (!user) { goLogin(); return; }
      await ready(user);
      await Purchases.restorePurchases();
      message('Your purchases were restored. Monthly plans from ' + storeName + ' are active again on this account.');
    } catch (error) { message(error && error.friendly ? error.message : 'Could not restore purchases. Please try again.'); }
  }
  async function manage() {
    var url = platform === 'android' ? 'https://play.google.com/store/account/subscriptions?package=co.hansora.app' : 'https://apps.apple.com/account/subscriptions';
    try {
      var user = await signedInUser();
      if (user && Purchases && key) { await ready(user); var info = await Purchases.getCustomerInfo(); var m = info && info.customerInfo && info.customerInfo.managementURL; if (m) url = m; }
    } catch (_) {}
    try { if (Cap && Cap.Plugins && Cap.Plugins.Browser) return Cap.Plugins.Browser.open({ url: url }); } catch (_) {}
    location.href = url;
  }

  // Store prices in the person's own currency, under each Buy button (Apple and Google may show another currency).
  async function showStorePrices(buttons) {
    try {
      var user = await signedInUser(); if (!user || !Purchases || !key) return;
      await ready(user);
      var ids = Object.values(PACKS), subs = Object.values(PLANS);
      var all = [].concat((await Purchases.getProducts({ productIdentifiers: ids, type: 'NON_SUBSCRIPTION' })).products || [], (await Purchases.getProducts({ productIdentifiers: subs, type: 'SUBSCRIPTION' })).products || []);
      var byId = {}; all.forEach(function (p) { byId[String(p.identifier).split(':')[0]] = p; });
      buttons.forEach(function (b) {
        var p = byId[b.dataset.appProduct]; if (!p || p.currencyCode === 'USD' || b.nextElementSibling && b.nextElementSibling.classList.contains('app-store-price')) return;
        var line = document.createElement('p'); line.className = 'app-store-price'; line.textContent = 'In ' + storeName + ': ' + p.priceString + (b.dataset.appSub ? ' / month' : '');
        b.insertAdjacentElement('afterend', line);
      });
    } catch (_) {}
  }

  // ---- Wire the website's Buy buttons to the store (capture phase: the website checkout never opens). ----
  function productFor(el) {
    if (el.matches('a.buy-credits[data-credits], [data-credits].buy-credits')) return { id: PACKS[el.dataset.credits], sub: false };
    if (el.matches('.buy-subscription[data-plan-id]')) return { id: PLANS[el.dataset.planId], sub: true };
    if (el.matches('[data-pack]')) return { id: PACKS[AUTOMATION_PACKS[el.dataset.pack]], sub: false };
    if (el.matches('[data-plan]')) return { id: PLANS[el.dataset.plan], sub: true };
    return null;
  }
  var BUTTONS = 'a.buy-credits[data-credits], .buy-subscription[data-plan-id], .ui-pack-buy[data-pack], .ui-pack-buy[data-plan]';
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest(BUTTONS) : null;
    if (!el) return;
    var p = productFor(el); if (!p || !p.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (el.disabled && !el.hasAttribute('data-soon')) return;
    buy(p.id, p.sub, el);
  }, true);

  // Restore, manage and the subscription terms Apple and Google ask for, at the end of the page.
  function addFooter() {
    var main = document.querySelector('main') || document.body;
    if (!main || document.getElementById('appStoreBox')) return;
    var box = document.createElement('section');
    box.id = 'appStoreBox'; box.className = 'app-store-box';
    box.innerHTML =
      '<div class="app-store-actions"><button type="button" id="appRestore">Restore purchases</button><button type="button" id="appManage">Manage subscription</button></div>' +
      '<p>Payment is charged to your ' + (platform === 'android' ? 'Google Play' : 'Apple ID') + ' account when you confirm. ' +
      'Monthly plans renew automatically every month at the same price until you cancel. Cancel at least 24 hours before the end of the month ' +
      'in your ' + (platform === 'android' ? 'Google Play' : 'App Store') + ' subscription settings ("Manage subscription" above); the plan stays active until the end of the paid month. ' +
      'Credits from packs never expire. Credits work in Hansora Creative and Hansora Automation.</p>' +
      '<p><a href="/termsofuse.html">Terms of use</a> · <a href="/policy.html">Privacy policy</a></p>';
    main.appendChild(box);
    document.getElementById('appRestore').addEventListener('click', restore);
    document.getElementById('appManage').addEventListener('click', manage);
  }
  // Mark the buttons, remove website-only payment choices, show store prices.
  function prepare() {
    var buttons = [].slice.call(document.querySelectorAll(BUTTONS));
    buttons.forEach(function (b) {
      var p = productFor(b); if (!p || !p.id) return;
      b.dataset.appProduct = p.id; if (p.sub) b.dataset.appSub = '1';
      b.removeAttribute('data-soon'); if (b.disabled && !/current/i.test(b.textContent)) b.disabled = false;
      if (/available soon/i.test(b.textContent)) b.textContent = 'Buy';
      if (b.tagName === 'A') b.setAttribute('href', '#');
    });
    document.querySelectorAll('details').forEach(function (d) { if (/russian card|yoomoney|dodo/i.test(d.textContent)) d.hidden = true; });
    addFooter();
    if (!prepare.pricesShown && buttons.length) { prepare.pricesShown = true; showStorePrices(buttons); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepare); else prepare();
  var queued = false;
  new MutationObserver(function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; prepare(); }); }).observe(document.documentElement, { childList: true, subtree: true });

  window.HansoraIAP = { buy: buy, restore: restore, manage: manage, PACKS: PACKS, PLANS: PLANS };
})();
