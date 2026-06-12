(function () {
  'use strict';

  const STORAGE_KEY = 'hansora.language';
  const SUPPORTED = new Set(['en', 'ru']);
  const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'alt'];
  const textOriginals = new WeakMap();
  const attributeOriginals = new WeakMap();
  let language = readLanguage();
  let dictionary = {};
  let observer = null;
  let applying = false;

  function readLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.has(saved)) return saved;
    } catch (_) {}
    return 'en';
  }

  function writeLanguage(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
  }

  function translated(source) {
    return language === 'en' ? source : (dictionary[source] || source);
  }

  function shouldSkipElement(element) {
    if (!element || !element.closest) return false;
    return !!element.closest('script,style,code,pre,textarea,[data-i18n-ignore]');
  }

  function splitWhitespace(value) {
    const match = String(value || '').match(/^(\s*)(.*?)(\s*)$/s);
    return { before: match ? match[1] : '', text: match ? match[2] : value, after: match ? match[3] : '' };
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement || shouldSkipElement(node.parentElement)) return;
    const parts = splitWhitespace(node.nodeValue);
    if (!parts.text) return;

    let source = textOriginals.get(node);
    if (!source) {
      source = parts.text;
      textOriginals.set(node, source);
    } else if (!applying) {
      const expected = translated(source);
      if (parts.text !== source && parts.text !== expected) {
        source = parts.text;
        textOriginals.set(node, source);
      }
    }

    const next = `${parts.before}${translated(source)}${parts.after}`;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateAttributes(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || shouldSkipElement(element)) return;
    let originals = attributeOriginals.get(element);
    if (!originals) {
      originals = {};
      attributeOriginals.set(element, originals);
    }

    ATTRIBUTE_NAMES.forEach(function (name) {
      if (!element.hasAttribute(name)) return;
      const current = element.getAttribute(name) || '';
      if (!originals[name]) originals[name] = current;
      else if (!applying) {
        const expected = translated(originals[name]);
        if (current !== originals[name] && current !== expected) originals[name] = current;
      }
      const next = translated(originals[name]);
      if (current !== next) element.setAttribute(name, next);
    });
  }

  function translateTree(root) {
    if (!root) return;
    applying = true;
    try {
      if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
      if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else translateAttributes(node);
        node = walker.nextNode();
      }
      document.documentElement.lang = language;
      syncSwitcher();
    } finally {
      applying = false;
    }
  }

  async function loadDictionary(nextLanguage) {
    const response = await fetch(`/translations/${nextLanguage}.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`translation_load_failed_${nextLanguage}`);
    return response.json();
  }

  async function setLanguage(nextLanguage) {
    const next = SUPPORTED.has(nextLanguage) ? nextLanguage : 'en';
    dictionary = await loadDictionary(next);
    language = next;
    writeLanguage(next);
    translateTree(document.body);
    window.dispatchEvent(new CustomEvent('hansora:languagechange', { detail: { language: next } }));
    return next;
  }

  function closeMenus() {
    document.querySelectorAll('.hansora-language-menu.is-open').forEach(function (menu) {
      menu.classList.remove('is-open');
    });
  }

  function syncSwitcher() {
    document.querySelectorAll('[data-hansora-language-current]').forEach(function (label) {
      const next = language === 'ru' ? 'RU' : 'EN';
      if (label.textContent !== next) label.textContent = next;
    });
    document.querySelectorAll('[data-hansora-language]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.hansoraLanguage === language);
    });
  }

  function ensureStyles() {
    if (document.getElementById('hansoraI18nStyles')) return;
    const style = document.createElement('style');
    style.id = 'hansoraI18nStyles';
    style.textContent = `
      .hansora-language-wrap{position:relative;display:inline-flex;z-index:1100}
      .hansora-language-button{min-width:42px;height:38px;padding:0 11px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.06);color:#fff;font:800 12px/1 inherit;cursor:pointer}
      .hansora-language-button:hover{background:rgba(255,255,255,.1)}
      .hansora-language-menu{position:absolute;top:calc(100% + 9px);right:0;display:none;width:150px;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#11131a;box-shadow:0 18px 55px rgba(0,0,0,.48)}
      .hansora-language-menu.is-open{display:grid;gap:4px}
      .hansora-language-option{width:100%;padding:10px 11px;border:0;border-radius:10px;background:transparent;color:#fff;text-align:left;font:750 13px/1.2 inherit;cursor:pointer}
      .hansora-language-option:hover,.hansora-language-option.is-active{background:rgba(99,102,241,.2)}
      .hansora-language-floating{position:fixed;top:14px;right:14px;z-index:9999}
      @media(max-width:720px){.hansora-language-button{min-width:34px;height:32px;padding:0 8px;border-radius:10px;font-size:11px}.site-header .hansora-language-wrap{order:-1}}
    `;
    document.head.appendChild(style);
  }

  function ensureSwitcher() {
    ensureStyles();
    let wrap = document.getElementById('hansoraLanguageSwitcher');
    const headerActions = document.querySelector('.site-header .nav-actions');

    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'hansoraLanguageSwitcher';
      wrap.className = 'hansora-language-wrap';
      wrap.setAttribute('data-i18n-ignore', '');
      wrap.innerHTML = `
        <button class="hansora-language-button" type="button" aria-label="Choose language"><span data-hansora-language-current>EN</span></button>
        <div class="hansora-language-menu">
          <button class="hansora-language-option" type="button" data-hansora-language="en">English</button>
          <button class="hansora-language-option" type="button" data-hansora-language="ru">Russian</button>
        </div>`;
      wrap.querySelector('.hansora-language-button').addEventListener('click', function (event) {
        event.stopPropagation();
        wrap.querySelector('.hansora-language-menu').classList.toggle('is-open');
      });
      wrap.querySelectorAll('[data-hansora-language]').forEach(function (button) {
        button.addEventListener('click', async function () {
          closeMenus();
          await setLanguage(button.dataset.hansoraLanguage);
        });
      });
    }

    if (headerActions && wrap.parentElement !== headerActions) {
      wrap.classList.remove('hansora-language-floating');
      headerActions.insertBefore(wrap, headerActions.firstChild);
    } else if (!headerActions && !wrap.parentElement) {
      wrap.classList.add('hansora-language-floating');
      document.body.appendChild(wrap);
    }
    syncSwitcher();
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(function (mutations) {
      if (applying) return;
      let needsSwitcher = false;
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        if (mutation.type === 'attributes') translateAttributes(mutation.target);
        mutation.addedNodes.forEach(function (node) {
          translateTree(node);
          if (node.nodeType === Node.ELEMENT_NODE && (node.matches('.site-header,.nav-actions') || node.querySelector('.site-header,.nav-actions'))) needsSwitcher = true;
        });
      });
      if (needsSwitcher || !document.getElementById('hansoraLanguageSwitcher')) ensureSwitcher();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTE_NAMES
    });
  }

  async function init() {
    try {
      dictionary = await loadDictionary(language);
    } catch (error) {
      console.warn('Hansora translations could not be loaded.', error);
      language = 'en';
      dictionary = {};
    }
    ensureSwitcher();
    translateTree(document.body);
    observe();
    window.dispatchEvent(new CustomEvent('hansora:i18nready', { detail: { language } }));
  }

  window.HansoraI18n = {
    getLanguage: function () { return language; },
    setLanguage,
    translate: function (source) { return translated(String(source || '')); },
    translateTree
  };

  document.addEventListener('click', closeMenus);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
