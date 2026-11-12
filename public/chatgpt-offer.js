/* Welcome offer (see lib/business/chatgpt-offer.mjs). Loaded on every page by header.js.
   Shown to signed-in people who never bought (wherever they signed up: the site or the ChatGPT plugin), and to
   logged-out visitors: their clock starts on their first look at the pricing page, is kept in their browser and
   carries into their account when they sign up (never restarted, never longer). The 8-hour timer starts the first
   time they open the pricing page; it is kept on the server, so a refresh or another device shows the same time.
   The pages load and work as before: this file runs after the page and adds the offer when the server answers.
     - every page: a small floating pill that opens the pricing page (with the countdown once the timer runs);
     - pricing pages: a countdown strip above the packs and, on each pack, the credits the offer gives (+25% free);
     - pricing pages: a popup with the $4.99 starter pack, shown when the visitor is leaving or has waited a while
       without buying. The starter pack is never in the pack list.
   The server decides who gets the offer and what a payment grants; this file only shows it. Everyone else sees
   nothing and the pages work as before. International cards only (Dodo). */
(function () {
  "use strict";
  // In a frame it runs only on the pricing page: that is the pricing popup the header opens for new users.
  var IN_FRAME = window.top !== window.self;
  if (window.__hansoraChatgptOffer || (IN_FRAME && !/^\/pricing(_ru|_arm)?(\.html)?\/?$/.test(location.pathname))) return;
  window.__hansoraChatgptOffer = true;

  var ENDPOINT = "/.netlify/functions/chatgpt-offer";
  var CACHE_PREFIX = "hansora:cgoffer:";
  var NOT_ELIGIBLE_CACHE_MS = 2 * 60 * 60 * 1000;
  var POPUP_DELAY_MS = 40 * 1000;
  // The starter popup opens by itself once per person (remembered in this browser); after that only the button opens it.
  var POPUP_AUTO_KEY = "hansora:cgoffer:starter-auto:";
  var MULTIPLIER = 10; // stored credits -> credits as shown on the site

  var TEXT = {
    en: {
      pill: "Welcome offer: +{p}% credits", pillWaiting: "See offer", ends: "ends in", stripTag: "Welcome offer", strip: "+{p}% FREE credits on your first pack", stripSub: "One time only. When the clock hits zero, it is gone.", anonSub: "Create a free account and buy before the clock hits zero. One time only.", stripEnds: "Ends in",
      badge: "🎁 +{p}% FREE", cardCredits: "credits", split: "{base} + <b>{free} free</b>", h: "hrs", m: "min", sec: "sec", starterLink: "🎁 Starter pack: {credits} credits for {price}",
      popTag: "Welcome offer · one time", popTitle: "Try Hansora for just {price}", popText: "A small pack made for your first purchase. You will not find it on the pricing page.",
      popCredits: "{credits} credits", popOnce: "one payment", popBuy: "Get {credits} credits for {price}", popNo: "No thanks", popEnds: "Offer ends in",
      popFacts: ["Works on Hansora and in ChatGPT", "No subscription", "Credits never expire"], close: "Close welcome offer"
    },
    ru: {
      pill: "Приветственное предложение: +{p}% кредитов", pillWaiting: "Открыть", ends: "осталось", stripTag: "Приветственное предложение", strip: "+{p}% кредитов В ПОДАРОК к первой покупке", stripSub: "Только один раз. Когда таймер дойдёт до нуля, предложение исчезнет.", anonSub: "Создайте бесплатный аккаунт и купите, пока таймер не дошёл до нуля. Только один раз.", stripEnds: "Осталось",
      badge: "🎁 +{p}% В ПОДАРОК", cardCredits: "кредитов", split: "{base} + <b>{free} в подарок</b>", h: "ч", m: "мин", sec: "сек", starterLink: "🎁 Стартовый пакет: {credits} кредитов за {price}",
      popTag: "Приветственное предложение · один раз", popTitle: "Попробуйте Hansora всего за {price}", popText: "Небольшой пакет для первой покупки. На странице цен его нет.",
      popCredits: "{credits} кредитов", popOnce: "разовый платёж", popBuy: "Получить {credits} кредитов за {price}", popNo: "Нет, спасибо", popEnds: "Осталось",
      popFacts: ["Работает на Hansora и в ChatGPT", "Без подписки", "Кредиты не сгорают"], close: "Закрыть предложение"
    },
    hy: {
      pill: "Ողջույնի առաջարկ՝ +{p}% կրեդիտ", pillWaiting: "Տեսնել", ends: "մնաց", stripTag: "Ողջույնի առաջարկ", strip: "+{p}% ԱՆՎՃԱՐ կրեդիտ առաջին գնման համար", stripSub: "Միայն մեկ անգամ։ Երբ ժամանակը լրանա, առաջարկը կվերանա։", anonSub: "Ստեղծեք անվճար հաշիվ և գնեք, մինչև ժամանակը կլրանա։ Միայն մեկ անգամ։", stripEnds: "Մնաց",
      badge: "🎁 +{p}% ԱՆՎՃԱՐ", cardCredits: "կրեդիտ", split: "{base} + <b>{free} անվճար</b>", h: "ժ", m: "ր", sec: "վ", starterLink: "🎁 Մեկնարկային փաթեթ՝ {credits} կրեդիտ {price}-ով",
      popTag: "Ողջույնի առաջարկ · մեկ անգամ", popTitle: "Փորձեք Hansora-ն ընդամենը {price}-ով", popText: "Փոքր փաթեթ առաջին գնման համար։ Գների էջում այն չկա։",
      popCredits: "{credits} կրեդիտ", popOnce: "մեկանգամյա վճարում", popBuy: "Գնել {credits} կրեդիտ՝ {price}", popNo: "Ոչ, շնորհակալություն", popEnds: "Մնաց",
      popFacts: ["Աշխատում է Hansora-ում և ChatGPT-ում", "Առանց բաժանորդագրության", "Կրեդիտները չեն սպառվում"], close: "Փակել առաջարկը"
    }
  };
  function lang() {
    var value = String(document.documentElement.lang || "en").slice(0, 2).toLowerCase();
    if (value === "am") value = "hy";
    if (/_arm\.html$/.test(location.pathname)) value = "hy";
    if (/_ru\.html$/.test(location.pathname)) value = "ru";
    return TEXT[value] ? value : "en";
  }
  function T() { return TEXT[lang()]; }
  function fill(text, values) {
    return String(text).replace(/\{(\w+)\}/g, function (_, key) { return values[key] == null ? "" : values[key]; });
  }
  function shown(stored) { return (Number(stored) * MULTIPLIER).toLocaleString("en-US"); }
  function money(cents) { return "$" + (Number(cents) / 100).toFixed(2); }
  function two(n) { return String(n).padStart(2, "0"); }
  function clock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return two(Math.floor(s / 3600)) + ":" + two(Math.floor((s % 3600) / 60)) + ":" + two(s % 60);
  }
  // A clock made of three boxes (hours, minutes, seconds); setSegments() keeps every clock on the page in step.
  function segmentsHtml() {
    var t = T();
    return '<span class="cgo-clock" data-cgo-segments>' +
      '<span class="cgo-seg"><b data-cgo-part="h">00</b><i>' + t.h + '</i></span><em>:</em>' +
      '<span class="cgo-seg"><b data-cgo-part="m">00</b><i>' + t.m + '</i></span><em>:</em>' +
      '<span class="cgo-seg"><b data-cgo-part="s">00</b><i>' + t.sec + '</i></span></span>';
  }
  function setSegments(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var parts = { h: two(Math.floor(s / 3600)), m: two(Math.floor((s % 3600) / 60)), s: two(s % 60) };
    document.querySelectorAll("[data-cgo-segments] [data-cgo-part]").forEach(function (el) {
      var value = parts[el.getAttribute("data-cgo-part")];
      if (el.textContent !== value) el.textContent = value;
    });
  }
  function isPricingPage() { return /^\/pricing(_ru|_arm)?(\.html)?\/?$/.test(location.pathname); }
  function pricingHref() { return lang() === "ru" ? "/pricing_ru.html" : lang() === "hy" ? "/pricing_arm.html" : "/pricing.html"; }

  // ---------- who is signed in ----------
  function storedSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(key || "")) continue;
        var parsed = JSON.parse(localStorage.getItem(key) || "{}");
        var session = parsed.currentSession || parsed.session || parsed;
        if (session && session.user && session.user.id && session.access_token) return session;
      }
    } catch (_) {}
    return null;
  }
  function accessToken(fallback) {
    var api = window.HansoraHeader;
    if (api && typeof api.getAccessToken === "function") {
      return api.getAccessToken().then(function (token) { return token || fallback; }).catch(function () { return fallback; });
    }
    return Promise.resolve(fallback);
  }
  function readCache(userId) {
    try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + userId) || "null"); } catch (_) { return null; }
  }
  function writeCache(userId, value) {
    try { localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value)); } catch (_) {}
  }
  function cameFromChatgpt() {
    try {
      if (/[?&]from=chatgpt_/.test(location.search)) return true;
      for (var i = 0; i < sessionStorage.length; i++) {
        if (/^hansora:chatgpt_[a-z_]+_link_opened$/.test(sessionStorage.key(i) || "")) return true;
      }
    } catch (_) {}
    return false;
  }

  // What people do with the offer, saved in click_events through header.js (element_label = the event name,
  // element_id = the detail):
  //   welcome_offer_shown           the banner with the clock appeared on the pricing page (once per visit)
  //   welcome_offer_pill_clicked    the pill on another page was clicked
  //   welcome_starter_shown         the $4.99 popup appeared (details: waited / leaving / link)
  //   welcome_starter_closed        it was closed (details: x / no_thanks / outside)
  //   welcome_starter_reopened      the small "Starter pack" button was clicked
  //   welcome_starter_buy_clicked   its Buy button was clicked
  // Purchases themselves are in chatgpt_offers (used_at, used_product). See docs/sql/welcome-offer-funnel.sql.
  function track(name, detail) {
    try {
      var api = window.HansoraHeader;
      if (!api || typeof api.recordEvent !== "function") return;
      var result = api.recordEvent(name, { elementType: "offer", elementId: detail || name, destination: location.pathname });
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (_) {}
  }
  function trackOnce(name, detail) {
    try {
      if (sessionStorage.getItem("hansora:cgoffer:ev:" + name)) return;
      sessionStorage.setItem("hansora:cgoffer:ev:" + name, "1");
    } catch (_) {}
    track(name, detail);
  }

  var offer = null;      // the server's answer while the offer is running
  var endsAt = 0;
  var user = null;
  var ticker = null;
  var pill = null, strip = null, popup = null;
  var popupTimer = null;

  var ANON_KEY = "hansora:cgoffer:anon";
  var PREVIEW_KEY = "hansora:cgoffer:preview";
  var PENDING_STARTER_KEY = "hansora:cgoffer:pending-starter";
  var PENDING_MS = 15 * 60 * 1000;
  var accountRequest = null;

  function load() {
    var session = storedSession();
    if (session) loadAccount(session); else loadAnonymous();
  }

  // ---------- logged-out visitors ----------
  // The clock lives in this browser: { started_at } from the first look at the pricing page. Without storage there is
  // no honest clock to show, so nothing is shown.
  function readAnon() {
    try {
      var saved = JSON.parse(localStorage.getItem(ANON_KEY) || "null");
      return saved && Number(saved.started_at) > 0 ? saved : null;
    } catch (_) { return null; }
  }
  function startAnon() {
    try { localStorage.setItem(ANON_KEY, JSON.stringify({ started_at: Date.now() })); } catch (_) { return null; }
    return readAnon();
  }
  function preview() {
    try {
      var cached = JSON.parse(localStorage.getItem(PREVIEW_KEY) || "null");
      if (cached && Date.now() - Number(cached.at || 0) < 60 * 60 * 1000 && cached.data) return Promise.resolve(cached.data);
    } catch (_) {}
    return fetch(ENDPOINT + "?preview=1").then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
      if (data) { try { localStorage.setItem(PREVIEW_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (_) {} }
      return data;
    });
  }
  function loadAnonymous() {
    var anon = readAnon();
    if (!anon && !isPricingPage()) return;
    preview().then(function (data) {
      if (!data || !data.enabled || storedSession()) return;
      anon = anon || startAnon();
      if (!anon) return;
      var ends = Number(anon.started_at) + Number(data.offer_hours || 8) * 3600000;
      if (ends <= Date.now()) return;
      start(Object.assign({}, data, { active: true, anonymous: true, expires_at: new Date(ends).toISOString() }));
      watchForLogin();
    }).catch(function () {});
  }
  // Signing in on this page (the email login popup) switches to the account's offer, which continues this clock.
  var loginWatch = null;
  function watchForLogin() {
    if (loginWatch) return;
    var began = Date.now();
    loginWatch = setInterval(function () {
      var session = storedSession();
      if (!session && Date.now() - began < 30 * 60 * 1000) return;
      clearInterval(loginWatch);
      if (session && !accountRequest) loadAccount(session);
    }, 1500);
  }

  // ---------- signed-in people ----------
  function loadAccount(session) {
    user = session.user;
    var anon = readAnon();
    var cached = readCache(user.id);
    var now = Date.now();
    var freshVisit = cameFromChatgpt() || Boolean(anon);
    if (cached && !cached.active && !cached.pending && !freshVisit && now - Number(cached.checked_at || 0) < NOT_ELIGIBLE_CACHE_MS) return Promise.resolve(cached);
    // A running offer is shown from the cache at once (no flicker between pages); the server still has the last word.
    if (cached && cached.active && Date.parse(cached.expires_at) > now) start(cached);
    else if (cached && cached.pending && !isPricingPage() && !anon) showWaiting(cached);
    // The pricing page starts the timer; so does a clock this browser showed before signing in (it continues).
    var params = [];
    if (isPricingPage() || anon) params.push("start=1");
    if (anon) params.push("since=" + encodeURIComponent(String(anon.started_at)));
    var url = ENDPOINT + (params.length ? "?" + params.join("&") : "");
    accountRequest = accessToken(session.access_token).then(function (token) {
      if (!token) return null;
      return fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (res) { return res.ok ? res.json() : null; });
    }).then(function (data) {
      if (!data) return null;
      writeCache(user.id, Object.assign({ checked_at: Date.now() }, data));
      if (data.active && Date.parse(data.expires_at) > Date.now()) start(data);
      else { stop(); if (data.pending && !isPricingPage()) showWaiting(data); }
      resumePendingStarter(data);
      return data;
    }).catch(function () { return null; });
    return accountRequest;
  }
  // The $4.99 Buy was clicked while logged out: now that they are signed in, open its checkout.
  function resumePendingStarter(data) {
    var at = 0;
    try { at = Number(localStorage.getItem(PENDING_STARTER_KEY) || 0); localStorage.removeItem(PENDING_STARTER_KEY); } catch (_) {}
    if (!at || Date.now() - at > PENDING_MS || !data || !data.active || !data.starter) return;
    buyStarter(null);
  }
  // The pricing pages wait for this (at most a moment) before opening a checkout, so a purchase right after signing
  // up already counts for the offer.
  window.HansoraWelcomeOffer = {
    sync: function () {
      if (accountRequest) return accountRequest;
      var session = storedSession();
      if (!session) return Promise.resolve(null);
      return loadAccount(session);
    }
  };

  // The timer has not started yet: the pill only says an offer is waiting on the pricing page.
  function showWaiting(data) {
    addStyles();
    if (!pill) {
      pill = document.createElement("a");
      pill.className = "cgo-pill";
      pill.href = pricingHref();
      pill.setAttribute("data-cgo", "pill-waiting");
      pill.addEventListener("click", function () { track("welcome_offer_pill_clicked", "waiting"); });
      document.body.appendChild(pill);
    }
    pill.innerHTML = '<span class="cgo-pill-text"></span><span class="cgo-pill-time"><b></b></span>';
    pill.querySelector(".cgo-pill-text").textContent = "🎁 " + fill(T().pill, { p: data.bonus_percent || 25 });
    pill.querySelector(".cgo-pill-time b").textContent = T().pillWaiting + " →";
  }

  function start(data) {
    if (pill && pill.getAttribute("data-cgo") === "pill-waiting") { pill.remove(); pill = null; }
    offer = data;
    endsAt = Date.parse(data.expires_at);
    addStyles();
    render();
    if (!ticker) ticker = setInterval(render, 1000);
    if (isPricingPage()) armStarterPopup();
  }
  function stop() {
    offer = null;
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (popupTimer) { clearTimeout(popupTimer); popupTimer = null; }
    [pill, strip, popup].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
    pill = strip = popup = null;
    document.querySelectorAll(".cgo-card, .cgo-badge").forEach(function (el) { el.remove(); });
    document.querySelectorAll("[data-cgo-save]").forEach(function (el) { el.textContent = el.getAttribute("data-cgo-save"); el.removeAttribute("data-cgo-save"); });
    document.documentElement.classList.remove("cgo-on");
  }

  function render() {
    if (!offer) return;
    var left = endsAt - Date.now();
    if (left <= 0) {
      if (user) writeCache(user.id, { checked_at: Date.now(), eligible: true, active: false });
      stop();
      return;
    }
    document.documentElement.classList.add("cgo-on");
    var time = clock(left);
    if (isPricingPage()) { renderStrip(time); renderLines(); } else renderPill(time);
    setSegments(left);
  }

  // ---------- every page: floating pill ----------
  function renderPill(time) {
    if (!pill) {
      pill = document.createElement("a");
      pill.className = "cgo-pill";
      pill.href = pricingHref();
      pill.setAttribute("data-cgo", "pill");
      pill.addEventListener("click", function () { track("welcome_offer_pill_clicked", "running"); });
      pill.innerHTML = '<span class="cgo-pill-text"></span><span class="cgo-pill-time"><span data-cgo-ends></span> <b data-cgo-clock></b></span>';
      document.body.appendChild(pill);
    }
    pill.querySelector(".cgo-pill-text").textContent = "🎁 " + fill(T().pill, { p: offer.bonus_percent });
    pill.querySelector("[data-cgo-ends]").textContent = T().ends;
    pill.querySelector("[data-cgo-clock]").textContent = time;
  }

  // ---------- pricing page: strip above the packs, and a line on each pack ----------
  function packsGrid() { return document.querySelector(".grid[data-payg-offers]"); }
  function renderStrip(time) {
    var grid = packsGrid();
    if (!grid) return;
    if (!strip || !strip.isConnected) {
      strip = document.createElement("div");
      strip.className = "cgo-strip";
      strip.setAttribute("data-cgo", "strip");
      strip.innerHTML = '<div class="cgo-strip-copy"><span class="cgo-strip-tag"></span><div class="cgo-strip-text"></div><div class="cgo-strip-sub"></div></div>' +
        '<div class="cgo-strip-timer"><span class="cgo-strip-ends"></span>' + segmentsHtml() + '</div>' +
        '<button type="button" class="cgo-starter-link" hidden></button>';
      grid.parentNode.insertBefore(strip, grid);
      trackOnce("welcome_offer_shown");
      strip.querySelector(".cgo-starter-link").addEventListener("click", function () { track("welcome_starter_reopened"); openStarter("link"); });
    }
    strip.querySelector(".cgo-strip-tag").textContent = "🎁 " + T().stripTag;
    strip.querySelector(".cgo-strip-text").textContent = fill(T().strip, { p: offer.bonus_percent });
    strip.querySelector(".cgo-strip-sub").textContent = offer.anonymous ? T().anonSub : T().stripSub;
    strip.querySelector(".cgo-strip-ends").textContent = T().stripEnds;
    // The starter button is always there while the offer runs.
    var link = strip.querySelector(".cgo-starter-link");
    if (offer.starter) {
      link.hidden = false;
      link.textContent = fill(T().starterLink, { credits: shown(offer.starter.credits), price: money(offer.starter.price_cents) });
    } else link.hidden = true;
  }
  // The page rebuilds its pack cards when the visitor switches payment method, so the lines are checked every second.
  function renderLines() {
    var grid = packsGrid();
    if (!grid) return;
    var byCredits = {};
    (offer.packs || []).forEach(function (pack) { byCredits[String(pack.credits)] = pack; });
    grid.querySelectorAll(".buy-credits[data-credits]").forEach(function (button) {
      var pack = byCredits[String(button.getAttribute("data-credits"))];
      var card = button.closest(".rounded-2xl");
      if (!card || !pack || pack.offer_credits <= pack.credits) return;
      var title = card.querySelector(".mt-3.text-5xl");
      if (!title) return;
      var block = card.querySelector(".cgo-card");
      if (!block) {
        block = document.createElement("div");
        block.className = "cgo-card";
        title.parentNode.insertBefore(block, title);
        card.classList.add("cgo-has-offer");
      }
      // Base credits are what the pack gives without any gift; everything above them is free.
      var base = BASE[String(pack.credits)] || pack.credits;
      // The "+25% FREE" badge sits in the card's top row, next to its "Save $..." pill.
      var row = card.querySelector(":scope > .flex.items-center.justify-between");
      var badgeText = fill(T().badge, { p: offer.bonus_percent });
      var badge = row ? row.querySelector(".cgo-badge") : null;
      if (row && !badge) {
        badge = document.createElement("span");
        badge.className = "cgo-badge";
        row.insertBefore(badge, row.firstChild);
      }
      if (badge && badge.textContent !== badgeText) badge.textContent = badgeText;
      // "Save $5" counts only the price cut. With the offer the buyer also gets free credits, worth their share of
      // the pack price, so the pill shows both: $5 + (230 free / 900) x $9.99 = $7.50 ($15, $37.50 and $75 on the bigger packs).
      var save = row ? row.querySelector("span:not(.cgo-badge)") : null;
      if (save && /\$\s?[\d.,]+/.test(save.textContent) && !save.hasAttribute("data-cgo-save")) {
        var was = parseFloat((save.textContent.match(/\$\s?([\d.,]+)/) || [])[1].replace(/,/g, ""));
        var baseCredits = BASE[String(pack.credits)] || pack.credits;
        var extra = (pack.offer_credits - baseCredits) / baseCredits * (pack.price_cents / 100);
        var total = Math.round((was + extra) * 2) / 2; // to the nearest 50 cents
        save.setAttribute("data-cgo-save", save.textContent);
        save.textContent = save.textContent.replace(/\$\s?[\d.,]+/, "$" + (total % 1 ? total.toFixed(2) : String(total)));
      }
      var html = (row ? '' : '<span class="cgo-badge">' + badgeText + '</span>') +
        '<div class="cgo-big"><s>' + shown(pack.credits) + '</s><strong>' + shown(pack.offer_credits) + '</strong><span>' + T().cardCredits + '</span></div>' +
        '<div class="cgo-split">' + fill(T().split, { base: shown(base), free: shown(pack.offer_credits - base) }) + '</div>';
      if (block.innerHTML !== html) block.innerHTML = html;
    });
  }
  var BASE = { "90": 90, "200": 180, "510": 450, "1050": 900 };

  // ---------- pricing page: starter pack popup ----------
  function armStarterPopup() {
    // Not inside the header's pricing popup (a popup over a popup); the button is there instead.
    if (!offer || !offer.starter || popupArmed || IN_FRAME) return;
    popupArmed = true;
    if (autoShown()) return;
    var bought = false;
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest(".buy-credits, .buy-subscription") : null;
      if (target) bought = true;
    }, true);
    function maybeOpen(reason) {
      if (bought || popup || !offer || autoShown()) return;
      if (document.documentElement.getAttribute("data-payment-mode") === "ru") return;
      openStarter(reason);
    }
    popupTimer = setTimeout(function () { maybeOpen("waited"); }, POPUP_DELAY_MS);
    // On a computer: the pointer leaving through the top of the page means the visitor is about to go.
    document.addEventListener("mouseout", function (event) {
      if (!event.relatedTarget && event.clientY <= 0) maybeOpen("leaving");
    });
  }
  var popupArmed = false, shownByItself = false;
  function autoShown() {
    if (shownByItself) return true;
    try {
      return localStorage.getItem(POPUP_AUTO_KEY) === "1" || Boolean(user && localStorage.getItem(POPUP_AUTO_KEY + user.id) === "1");
    } catch (_) { return false; }
  }
  function openStarter(reason) {
    if (!offer || !offer.starter || popup) return;
    // Once it has been open, it never opens by itself again.
    shownByItself = true;
    try { localStorage.setItem(POPUP_AUTO_KEY + (user ? user.id : ""), "1"); } catch (_) {}
    var t = T();
    var values = { credits: shown(offer.starter.credits), price: money(offer.starter.price_cents) };
    popup = document.createElement("div");
    popup.className = "cgo-pop";
    popup.setAttribute("data-cgo", "starter-popup");
    popup.setAttribute("data-cgo-reason", reason || "");
    popup.innerHTML =
      '<div class="cgo-pop-card" role="dialog" aria-modal="true" aria-labelledby="cgoPopTitle">' +
      '<button type="button" class="cgo-pop-x" aria-label="' + t.close + '">×</button>' +
      '<div class="cgo-pop-gift" aria-hidden="true">🎁</div>' +
      '<span class="cgo-pop-tag">' + t.popTag + '</span>' +
      '<h3 id="cgoPopTitle">' + fill(t.popTitle, values) + '</h3>' +
      '<p class="cgo-pop-text">' + t.popText + '</p>' +
      '<div class="cgo-pop-deal"><div class="cgo-pop-price"><strong>' + values.price + '</strong><span>' + t.popOnce + '</span></div>' +
      '<div class="cgo-pop-credits">' + fill(t.popCredits, values) + '</div></div>' +
      '<div class="cgo-pop-timer"><span>' + t.popEnds + '</span>' + segmentsHtml() + '</div>' +
      '<button type="button" class="cgo-pop-buy" data-cgo-buy>' + fill(t.popBuy, values) + '</button>' +
      '<ul class="cgo-pop-facts">' + t.popFacts.map(function (fact) { return "<li>" + fact + "</li>"; }).join("") + '</ul>' +
      '<button type="button" class="cgo-pop-no">' + t.popNo + '</button>' +
      '</div>';
    document.body.appendChild(popup);
    track("welcome_starter_shown", reason || "");
    setSegments(endsAt - Date.now());
    requestAnimationFrame(function () { if (popup) popup.classList.add("cgo-open"); });
    // Closing shrinks the card into the small starter button above the packs, so it can be opened again.
    function close() {
      var closing = popup;
      if (!closing) return;
      popup = null;
      render();
      var card = closing.querySelector(".cgo-pop-card");
      var chip = strip && strip.querySelector(".cgo-starter-link");
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!card || !chip || chip.hidden || reduce) { closing.remove(); return; }
      var from = card.getBoundingClientRect(), to = chip.getBoundingClientRect();
      var dx = to.left + to.width / 2 - (from.left + from.width / 2);
      var dy = to.top + to.height / 2 - (from.top + from.height / 2);
      var scale = Math.max(0.12, Math.min(1, to.width / from.width));
      closing.classList.add("cgo-closing");
      card.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + scale + ")";
      card.style.opacity = "0.15";
      chip.classList.add("cgo-chip-land");
      setTimeout(function () { closing.remove(); }, 460);
      setTimeout(function () { chip.classList.remove("cgo-chip-land"); }, 1400);
    }
    popup.addEventListener("click", function (event) {
      var how = event.target === popup ? "outside" : event.target.closest(".cgo-pop-x") ? "x" : event.target.closest(".cgo-pop-no") ? "no_thanks" : "";
      if (how) { track("welcome_starter_closed", how); close(); }
      else if (event.target.closest("[data-cgo-buy]")) { track("welcome_starter_buy_clicked"); buyStarter(event.target.closest("[data-cgo-buy]")); }
    });
  }
  function buyStarter(button) {
    if (!offer || !offer.starter) return;
    if (!user) {
      // Logged out: sign up first, then the checkout opens (here, or on the pricing page after a Google login).
      try {
        localStorage.setItem(PENDING_STARTER_KEY, String(Date.now()));
        localStorage.setItem("hansora:pricing-buy-return", JSON.stringify({ path: location.pathname + location.search, buy: "starter:" + offer.starter.credits, mode: "international", createdAt: Date.now() }));
      } catch (_) {}
      if (popup) { popup.remove(); popup = null; }
      var api = window.HansoraHeader;
      if (api && typeof api.openAuth === "function") api.openAuth("signup");
      return;
    }
    if (button) button.disabled = true;
    var url = new URL(offer.starter.checkout_url);
    url.searchParams.set("quantity", "1");
    url.searchParams.set("redirect_url", "https://hansora.co/profile.html?checkout=success");
    url.searchParams.set("minimalAddress", "true");
    url.searchParams.set("metadata_uid", user.id);
    url.searchParams.set("metadata_credits", String(offer.starter.credits));
    if (user.email) { url.searchParams.set("email", user.email); url.searchParams.set("metadata_email", user.email); }
    if (typeof window.hansoraPricingNavigate === "function") window.hansoraPricingNavigate(url.toString());
    else window.location.href = url.toString();
  }

  // ---------- styles ----------
  function addStyles() {
    if (document.getElementById("cgoStyles")) return;
    var style = document.createElement("style");
    style.id = "cgoStyles";
    style.textContent = [
      ".cgo-pill{position:fixed;left:16px;bottom:20px;z-index:60;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:999px;text-decoration:none;color:#fff;font:700 13px/1.2 Inter,system-ui,sans-serif;background:linear-gradient(90deg,#a855f7,#6366f1 60%,#0ea5e9);box-shadow:0 12px 34px rgba(99,102,241,.45);border:1px solid rgba(255,255,255,.18)}",
      ".cgo-pill-time{white-space:nowrap;padding:4px 9px;border-radius:999px;background:rgba(11,13,19,.45);font-weight:600}",
      ".cgo-pill-time b{font-variant-numeric:tabular-nums;font-weight:800}",
      // On phones the chat bubble sits bottom-right and the menu bar at the bottom: leave room for both.
      "@media (max-width:767px){.cgo-pill{left:12px;right:92px;bottom:calc(86px + env(safe-area-inset-bottom,0px));justify-content:space-between;max-width:none;padding:9px 10px 9px 14px}.cgo-pill [data-cgo-ends]{display:none}}",
      ".cgo-clock{display:inline-flex;align-items:flex-start;gap:6px;font-variant-numeric:tabular-nums}",
      ".cgo-clock em{font-style:normal;font-weight:900;font-size:22px;line-height:44px;color:rgba(255,255,255,.55)}",
      ".cgo-seg{display:flex;flex-direction:column;align-items:center;gap:3px}",
      ".cgo-seg b{min-width:46px;padding:8px 6px;border-radius:11px;text-align:center;font-size:24px;line-height:28px;font-weight:900;color:#fff;background:linear-gradient(180deg,#1b1630,#0c0d16);border:1px solid rgba(248,113,113,.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 6px 18px rgba(239,68,68,.22)}",
      ".cgo-seg i{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(254,202,202,.8)}",
      ".cgo-strip{position:relative;overflow:hidden;margin:0 auto 34px;max-width:900px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:14px 28px;border-radius:24px;padding:22px 26px;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:left;border:1px solid rgba(216,180,254,.6);background:linear-gradient(120deg,rgba(124,58,237,.5),rgba(79,70,229,.34) 45%,rgba(14,165,233,.3));box-shadow:0 24px 70px rgba(124,58,237,.35),inset 0 1px 0 rgba(255,255,255,.14)}",
      ".cgo-strip::before{content:'';position:absolute;top:0;bottom:0;left:-40%;width:35%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.16),transparent);animation:cgoShine 4.5s ease-in-out infinite;pointer-events:none}",
      "@keyframes cgoShine{0%,55%{left:-40%}100%{left:120%}}",
      ".cgo-strip-tag{display:inline-block;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.02em;background:rgba(11,13,19,.5);border:1px solid rgba(255,255,255,.2)}",
      ".cgo-strip-text{margin-top:10px;font-size:clamp(22px,3.2vw,32px);line-height:1.08;font-weight:900;letter-spacing:-.03em}",
      ".cgo-strip-sub{margin-top:7px;font-size:14px;font-weight:500;color:rgba(237,233,254,.82)}",
      ".cgo-strip-timer{display:flex;flex-direction:column;align-items:center;gap:7px}",
      ".cgo-strip-ends{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fecaca}",
      ".cgo-strip .cgo-starter-link{grid-column:1 / -1;justify-self:center;margin-top:0}",
      "@media (max-width:700px){.cgo-strip{grid-template-columns:1fr;text-align:center;padding:20px 16px;margin-bottom:26px}}",
      ".cgo-starter-link{margin-top:10px;display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(196,181,253,.55);border-radius:999px;padding:8px 14px;background:rgba(15,18,32,.6);color:#fff;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;transition:transform .2s,box-shadow .2s}",
      ".cgo-starter-link[hidden]{display:none}",
      ".cgo-starter-link:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(139,92,246,.35)}",
      ".cgo-chip-land{animation:cgoLand 1.2s ease-out}",
      "@keyframes cgoLand{0%{transform:scale(.8);box-shadow:0 0 0 0 rgba(168,85,247,.7)}35%{transform:scale(1.08)}100%{transform:scale(1);box-shadow:0 0 0 16px rgba(168,85,247,0)}}",
      ".cgo-card{margin-top:6px}",
      ".cgo-badge{display:inline-flex;align-items:center;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:900;letter-spacing:.01em;color:#052e1b;background:linear-gradient(135deg,#34d399,#a7f3d0);box-shadow:0 8px 22px rgba(52,211,153,.35)}",
      ".cgo-big{margin-top:12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;line-height:1}",
      ".cgo-big s{font-size:18px;font-weight:800;color:rgba(226,232,240,.45);text-decoration-thickness:2px}",
      ".cgo-big strong{font-size:40px;font-weight:900;letter-spacing:-.04em;background:linear-gradient(90deg,#6ee7b7,#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}",
      ".cgo-big span{font-size:18px;font-weight:800;color:#fff}",
      "@media (max-width:767px){.cgo-big s{font-size:22px}.cgo-big strong{font-size:48px}.cgo-big span{font-size:22px}}",
      ".cgo-split{margin-top:8px;font-size:15px;font-weight:600;color:rgba(226,232,240,.75)}",
      ".cgo-split b{color:#6ee7b7;font-weight:800}",
      // While the offer runs, each card shows the offer amount in place of its usual title and gift lines.
      "html.cgo-on[data-payment-mode='international'] .cgo-has-offer > .mt-3.text-5xl,html.cgo-on[data-payment-mode='international'] .cgo-has-offer .hs-gift-split,html.cgo-on[data-payment-mode='international'] .cgo-has-offer .hs-gift-badge,html.cgo-on[data-payment-mode='international'] .cgo-has-offer .hs-gift-line,html.cgo-on[data-payment-mode='international'] .cgo-has-offer .hs-upsell,html.cgo-on[data-payment-mode='international'] .cgo-has-offer > .flex.items-center.justify-between > .text-sm{display:none}",
      "html.cgo-on[data-payment-mode='international'] .cgo-has-offer{border-color:rgba(110,231,183,.45)}",
      "html[data-payment-mode='ru'] .cgo-strip,html[data-payment-mode='ru'] .cgo-card,html[data-payment-mode='ru'] .cgo-badge,html[data-pricing-plan-mode='monthly'] .cgo-strip{display:none}",
      ".cgo-pop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding:44px 16px 16px;overflow-y:auto;overscroll-behavior:contain;background:rgba(3,5,10,.74);backdrop-filter:blur(6px);font-family:Inter,system-ui,sans-serif;opacity:0;transition:opacity .25s ease}",
      ".cgo-pop.cgo-open{opacity:1}",
      ".cgo-pop.cgo-closing{background:rgba(3,5,10,0);backdrop-filter:none;transition:background .4s ease;pointer-events:none}",
      ".cgo-pop-card{position:relative;width:100%;max-width:400px;border-radius:26px;padding:26px 22px 18px;margin:auto;text-align:center;color:#e5e7eb;border:1px solid rgba(192,132,252,.55);background:linear-gradient(180deg,#221a45,#0f1220 70%);box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(168,85,247,.25),0 0 70px rgba(139,92,246,.35);transform:translateY(18px) scale(.94);transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .45s ease}",
      ".cgo-pop.cgo-open .cgo-pop-card{transform:none}",
      "@media (prefers-reduced-motion:reduce){.cgo-pop,.cgo-pop-card{transition:none}.cgo-pop-gift,.cgo-pop-buy,.cgo-strip::before{animation:none}}",
      ".cgo-pop-x{position:absolute;right:12px;top:10px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;font-size:20px;line-height:1;cursor:pointer}",
      ".cgo-pop-tag{display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;color:#fff;background:linear-gradient(135deg,#a855f7,#6366f1)}",
      ".cgo-pop-card h3{margin:14px 0 0;font-size:24px;line-height:1.15;font-weight:900;letter-spacing:-.02em;color:#fff}",
      ".cgo-pop-text{margin:8px 0 0;font-size:14px;line-height:1.5;color:rgba(226,232,240,.7)}",
      ".cgo-pop-gift{width:64px;height:64px;margin:-52px auto 10px;display:grid;place-items:center;border-radius:20px;font-size:34px;background:linear-gradient(135deg,#a855f7,#0ea5e9);box-shadow:0 14px 34px rgba(124,58,237,.55);animation:cgoFloat 3s ease-in-out infinite}",
      "@keyframes cgoFloat{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}",
      ".cgo-pop-deal{margin-top:16px;padding:16px;border-radius:18px;border:1px solid rgba(110,231,183,.35);background:linear-gradient(135deg,rgba(16,185,129,.16),rgba(14,165,233,.1))}",
      ".cgo-pop-price{display:flex;align-items:flex-end;gap:10px}",
      ".cgo-pop-price strong{font-size:58px;line-height:.95;font-weight:900;letter-spacing:-.04em;background:linear-gradient(90deg,#6ee7b7,#7dd3fc);-webkit-background-clip:text;background-clip:text;color:transparent}",
      ".cgo-pop-price span{padding-bottom:6px;font-size:13px;font-weight:600;color:rgba(226,232,240,.62)}",
      ".cgo-pop-credits{margin-top:8px;font-size:20px;font-weight:800;color:#fff}",
      ".cgo-pop-timer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:11px 14px;border-radius:14px;border:1px solid rgba(248,113,113,.4);background:rgba(127,29,29,.24);font-size:13px;font-weight:700;color:#fecaca}",
      ".cgo-pop-timer .cgo-seg b{min-width:42px;font-size:21px;padding:6px 5px}",
      ".cgo-pop-timer > span:first-child{text-transform:uppercase;letter-spacing:.08em;font-size:12px}",
      ".cgo-pop-buy{display:block;width:100%;margin-top:14px;padding:16px;border:0;border-radius:15px;color:#fff;font:800 17px Inter,system-ui,sans-serif;cursor:pointer;background:linear-gradient(90deg,#a855f7,#6366f1 55%,#0ea5e9);box-shadow:0 12px 34px rgba(99,102,241,.45);animation:cgoPulse 2.2s ease-in-out infinite}",
      "@keyframes cgoPulse{0%,100%{box-shadow:0 12px 34px rgba(99,102,241,.45)}50%{box-shadow:0 12px 44px rgba(168,85,247,.85),0 0 0 6px rgba(168,85,247,.14)}}",
      ".cgo-pop-buy:disabled{opacity:.6;cursor:default}",
      ".cgo-pop-price{justify-content:center}",
      ".cgo-pop-facts{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;font-size:13px;color:rgba(226,232,240,.86)}",
      ".cgo-pop-facts li{padding:6px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);font-size:12px;font-weight:600;white-space:nowrap}",
      ".cgo-pop-facts li::before{content:'✓';margin-right:6px;color:#34d399;font-weight:900}",
      ".cgo-pop-no{display:block;margin:12px auto 0;border:0;background:none;color:rgba(226,232,240,.55);font:600 13px Inter,system-ui,sans-serif;cursor:pointer}",
      // Phones: a shorter card that fits the screen with room around it, in every language.
      "@media (max-width:560px){.cgo-pop{padding:40px 22px 18px}.cgo-pop-card{max-width:340px;border-radius:22px;padding:18px 16px 12px}.cgo-pop-gift{width:50px;height:50px;margin:-42px auto 8px;border-radius:16px;font-size:26px}.cgo-pop-tag{padding:5px 10px;font-size:11px}.cgo-pop-card h3{margin-top:10px;font-size:19px}.cgo-pop-text{display:none}.cgo-pop-deal{margin-top:11px;padding:11px 12px;border-radius:15px}.cgo-pop-price strong{font-size:40px}.cgo-pop-price span{font-size:11px;padding-bottom:4px}.cgo-pop-credits{margin-top:4px;font-size:17px}.cgo-pop-timer{margin-top:10px;padding:8px 11px;border-radius:13px}.cgo-pop-timer .cgo-seg b{min-width:36px;padding:4px;font-size:18px;line-height:24px;border-radius:9px}.cgo-pop-timer .cgo-clock em{line-height:32px;font-size:18px}.cgo-pop-timer .cgo-seg i{font-size:9px}.cgo-pop-buy{margin-top:10px;padding:13px 8px;font-size:14.5px;border-radius:13px}.cgo-pop-facts{margin-top:9px;gap:2px 10px}.cgo-pop-facts li{padding:0;border:0;background:none;font-size:10.5px}.cgo-pop-no{margin-top:8px;font-size:12px}.cgo-pop-x{width:30px;height:30px;right:9px;top:8px;font-size:18px}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();
