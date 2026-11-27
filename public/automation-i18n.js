// Hansora Automation in Armenian and Russian, the same way as Hansora Creative: the address decides the
// language (automation-dashboard_arm.html = Armenian, _ru.html = Russian; Netlify serves the English file
// there), and the choice is saved in the profile (profiles.language) and in localStorage
// "hansora.language.v1". Creative's header.js keeps both in step on every page. The English text is then
// swapped for the chosen language, also text the scripts add later. Loaded first in <head>.
(function () {
  'use strict';
  var KEY = 'hansora.language.v1';
  var SUPPORTED = { en: 1, hy: 1, ru: 1 };
  var SUFFIX = { en: '', hy: '_arm', ru: '_ru' };
  var PAGE = /^\/automation(?:-[a-z0-9-]+)?(?:_(?:arm|ru))?(?:\.html)?$/i;
  function urlLanguage(path) { return /_arm(?:\.html)?$/i.test(path) ? 'hy' : /_ru(?:\.html)?$/i.test(path) ? 'ru' : 'en'; }
  // The same Automation page in another language, or null for any other link.
  function localized(href, language) {
    try {
      var url = new URL(href, location.href);
      if (url.origin !== location.origin || !PAGE.test(url.pathname)) return null;
      url.pathname = url.pathname.replace(/\.html$/i, '').replace(/_(?:arm|ru)$/i, '') + SUFFIX[language] + '.html';
      url.searchParams.delete('lang');
      return url.pathname + url.search + url.hash;
    } catch (_) { return null; }
  }
  var lang = urlLanguage(location.pathname);
  var here = location.pathname + location.search + location.hash;
  try {
    // ?lang=hy|ru|en opens that language's address.
    var asked = new URLSearchParams(location.search).get('lang');
    if (asked && SUPPORTED[asked]) {
      localStorage.setItem(KEY, asked);
      var target = localized(location.href, asked);
      if (target && target !== here) { location.replace(target); return; }
    } else if (lang === 'en') {
      // An English address while the saved choice is Armenian or Russian (for example after a link the
      // scripts build in English): go to the same page in that language.
      var saved = localStorage.getItem(KEY);
      if (saved === 'hy' || saved === 'ru') {
        var to = localized(location.href, saved);
        if (to && to !== here) { location.replace(to); return; }
      }
    }
  } catch (_) {}
  document.documentElement.lang = lang;

  var dict = Object.create(null);
  var patterns = [];
  var readyResolve;
  var api = window.HansoraI18n = {
    lang: lang,
    ready: new Promise(function (resolve) { readyResolve = resolve; }),
    localized: localized,
    // Translate one English string (for alerts, confirms and similar).
    t: function (text) { return translateText(String(text == null ? '' : text)) || String(text == null ? '' : text); },
    add: function (language, entries, extraPatterns) {
      if (language !== lang) return;
      for (var key in entries) dict[normalize(key)] = entries[key];
      if (extraPatterns) patterns = patterns.concat(extraPatterns);
    },
    // Change the language like Creative does: save it in the profile and the browser, then open the same
    // page at that language's address.
    set: function (language) {
      if (!SUPPORTED[language]) return Promise.resolve();
      try { localStorage.setItem(KEY, language); } catch (_) {}
      var auto = window.HansoraAutomation;
      var saveProfile = auto && auto.client && !auto.isLocalPreview && typeof auto.getUser === 'function'
        ? auto.getUser().then(function (user) {
          if (!user || !user.id) return null;
          return auto.client.from('profiles').update({ language: language === 'hy' ? 'arm' : language }).eq('user_id', user.id);
        }).catch(function () { return null; })
        : Promise.resolve();
      return saveProfile.then(function () {
        var to = localized(location.href, language);
        if (to && to !== location.pathname + location.search + location.hash) location.assign(to); else location.reload();
      });
    }
  };

  if (lang === 'en') { readyResolve(); return; }

  // The page stays hidden for a moment so the English text never flashes.
  var style = document.createElement('style');
  style.textContent = 'html.i18n-pending body{visibility:hidden!important}';
  document.head.appendChild(style);
  document.documentElement.classList.add('i18n-pending');
  var reveal = function () { document.documentElement.classList.remove('i18n-pending'); };
  var safety = setTimeout(reveal, 2500);

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function normalize(text) { return text.replace(/\s+/g, ' ').trim(); }
  function translateText(text) {
    var key = normalize(text);
    if (!key) return null;
    if (dict[key] != null) return dict[key];
    for (var i = 0; i < patterns.length; i++) {
      var match = key.match(patterns[i][0]);
      if (match) return patterns[i][1](match, function (part) { return dict[normalize(part)] != null ? dict[normalize(part)] : part; });
    }
    // "Instagram DMs · live", "English · Spanish": translate the parts that are known.
    if (key.indexOf(' · ') > 0) {
      var changed = false;
      var parts = key.split(' · ').map(function (part) { var t = translateText(part); if (t != null) { changed = true; return t; } return part; });
      if (changed) return parts.join(' · ');
    }
    return null;
  }
  function skipped(element) {
    for (var node = element; node && node.nodeType === 1; node = node.parentNode) {
      if (SKIP[node.nodeName] || node.isContentEditable || (node.hasAttribute && node.hasAttribute('data-no-i18n'))) return true;
    }
    return false;
  }
  function translateNode(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      if (!node.parentNode || skipped(node.parentNode)) return;
      var value = node.nodeValue;
      var translated = translateText(value);
      if (translated != null && translated !== normalize(value)) {
        var lead = value.match(/^\s*/)[0], tail = value.match(/\s*$/)[0];
        node.nodeValue = lead + translated + tail;
      }
      return;
    }
    if (node.nodeType !== 1 || skipped(node)) return;
    // Sentences with markup inside (bold words, links) are translated as a whole.
    if (node.hasAttribute('data-i18n-html') && !node.hasAttribute('data-i18n-done')) {
      var html = dict[normalize(node.innerHTML)];
      if (html != null) { node.innerHTML = html; node.setAttribute('data-i18n-done', ''); return; }
    }
    translateAttributes(node);
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) translateNode(children[i]);
  }
  // Links to other Automation pages keep the language (automation-inbox.html -> automation-inbox_arm.html).
  function localizeLink(element) {
    if (element.nodeName !== 'A') return;
    var href = element.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(?:mailto:|tel:|javascript:)/i.test(href)) return;
    var to = localized(href, lang);
    if (to && to !== href) element.setAttribute('href', to);
  }
  function translateAttributes(element) {
    localizeLink(element);
    for (var i = 0; i < ATTRS.length; i++) {
      var value = element.getAttribute(ATTRS[i]);
      if (!value) continue;
      var translated = translateText(value);
      if (translated != null && translated !== value) element.setAttribute(ATTRS[i], translated);
    }
    if (element.nodeName === 'INPUT' && /^(button|submit)$/i.test(element.type) && element.value) {
      var label = translateText(element.value);
      if (label != null) element.value = label;
    }
  }

  function start() {
    translateNode(document.body);
    var title = translateText(document.title);
    if (title) document.title = title;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === 'characterData') translateNode(record.target);
        else if (record.type === 'attributes') { if (record.target.nodeType === 1 && !skipped(record.target)) translateAttributes(record.target); }
        else for (var j = 0; j < record.addedNodes.length; j++) translateNode(record.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['href']) });
    clearTimeout(safety); reveal(); readyResolve();
  }

  var script = document.createElement('script');
  script.src = 'automation-i18n-' + lang + '.js?v=20261127r';
  script.onload = function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); };
  script.onerror = function () { clearTimeout(safety); reveal(); readyResolve(); };
  document.head.appendChild(script);
})();
