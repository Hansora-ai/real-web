// Hansora Automation in Armenian and Russian. The pages are written in English; this swaps the visible
// text (also text the scripts add later) for the chosen language. The language is the one chosen on
// Hansora Creative (localStorage "hansora.language.v1"), or ?lang=hy|ru|en. Loaded first in <head>.
(function () {
  'use strict';
  var KEY = 'hansora.language.v1';
  var SUPPORTED = { en: 1, hy: 1, ru: 1 };
  var lang = 'en';
  try {
    var asked = new URLSearchParams(location.search).get('lang');
    if (asked && SUPPORTED[asked]) localStorage.setItem(KEY, asked);
    var saved = localStorage.getItem(KEY);
    if (saved && SUPPORTED[saved]) lang = saved;
  } catch (_) {}
  document.documentElement.lang = lang;

  var dict = Object.create(null);
  var patterns = [];
  var readyResolve;
  var api = window.HansoraI18n = {
    lang: lang,
    ready: new Promise(function (resolve) { readyResolve = resolve; }),
    // Translate one English string (for alerts, confirms and similar).
    t: function (text) { return translateText(String(text == null ? '' : text)) || String(text == null ? '' : text); },
    add: function (language, entries, extraPatterns) {
      if (language !== lang) return;
      for (var key in entries) dict[normalize(key)] = entries[key];
      if (extraPatterns) patterns = patterns.concat(extraPatterns);
    },
    // Change the language for every Hansora page (Creative uses the same setting).
    set: function (language) {
      if (!SUPPORTED[language]) return;
      try { localStorage.setItem(KEY, language); } catch (_) {}
      var url = new URL(location.href); url.searchParams.delete('lang');
      location.replace(url.href);
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
      var parts = key.split(' · ').map(function (part) { var t = dict[part]; if (t != null) { changed = true; return t; } return part; });
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
  function translateAttributes(element) {
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
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    clearTimeout(safety); reveal(); readyResolve();
  }

  var script = document.createElement('script');
  script.src = 'automation-i18n-' + lang + '.js?v=20261118';
  script.onload = function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); };
  script.onerror = function () { clearTimeout(safety); reveal(); readyResolve(); };
  document.head.appendChild(script);
})();
