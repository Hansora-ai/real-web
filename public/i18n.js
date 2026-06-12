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
    document.querySelectorAll('[data-hansora-language-name]').forEach(function (label) {
      const next = language === 'ru' ? 'Русский' : 'English';
      if (label.textContent !== next) label.textContent = next;
    });
  }

  function ensureStyles() {
    if (document.getElementById('hansoraI18nStyles')) return;
    const style = document.createElement('style');
    style.id = 'hansoraI18nStyles';
    style.textContent = `
      .hansora-language-menu-row{width:100%;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:14px!important;border:0!important;color:inherit!important;text-align:left!important;cursor:pointer!important}
      .hansora-language-menu-row .hansora-language-current{display:flex;align-items:center;gap:7px;color:rgba(255,255,255,.48);font-size:12px;font-weight:800}
      .hansora-language-menu-row .hansora-language-chevron{font-size:16px;opacity:.42}
      .hansora-language-sheet-backdrop{position:fixed;inset:0;z-index:12000;display:flex;align-items:flex-end;justify-content:center;padding:18px;background:rgba(3,5,12,.66);backdrop-filter:blur(12px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .22s ease,visibility .22s ease}
      .hansora-language-sheet-backdrop.is-open{opacity:1;visibility:visible;pointer-events:auto}
      .hansora-language-sheet{width:min(520px,100%);padding:10px 10px 14px;border:1px solid rgba(255,255,255,.13);border-radius:28px;background:radial-gradient(circle at 15% 0%,rgba(99,102,241,.24),transparent 42%),linear-gradient(165deg,#1b1d28,#0c0e15 72%);box-shadow:0 30px 100px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.08);transform:translateY(26px) scale(.98);transition:transform .24s ease}
      .hansora-language-sheet-backdrop.is-open .hansora-language-sheet{transform:translateY(0) scale(1)}
      .hansora-language-handle{width:44px;height:4px;margin:2px auto 15px;border-radius:99px;background:rgba(255,255,255,.22)}
      .hansora-language-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:3px 9px 13px}
      .hansora-language-sheet-title{margin:0;color:#fff;font-size:20px;font-weight:950;letter-spacing:-.02em}
      .hansora-language-sheet-subtitle{margin:5px 0 0;color:rgba(255,255,255,.5);font-size:12px;font-weight:650}
      .hansora-language-sheet-close{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.1);border-radius:999px;background:rgba(255,255,255,.06);color:#fff;font-size:18px;cursor:pointer}
      .hansora-language-options{display:grid;gap:8px}
      .hansora-language-option{width:100%;display:flex;align-items:center;gap:14px;padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(255,255,255,.045);color:#fff;text-align:left;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}
      .hansora-language-option:hover{transform:translateY(-1px);background:rgba(255,255,255,.075)}
      .hansora-language-option.is-active{border-color:rgba(125,211,252,.42);background:linear-gradient(135deg,rgba(99,102,241,.2),rgba(56,189,248,.12))}
      .hansora-language-flag{width:48px;height:48px;display:grid;place-items:center;flex:0 0 48px;border-radius:15px;background:rgba(255,255,255,.08);font-size:29px;box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}
      .hansora-language-copy{display:grid;gap:4px;min-width:0}
      .hansora-language-copy strong{font-size:15px;font-weight:900}
      .hansora-language-copy small{color:rgba(255,255,255,.48);font-size:11px;font-weight:650}
      .hansora-language-check{margin-left:auto;width:25px;height:25px;display:grid;place-items:center;border-radius:99px;background:transparent;color:transparent;font-weight:950}
      .hansora-language-option.is-active .hansora-language-check{background:linear-gradient(135deg,#818cf8,#38bdf8);color:#fff}
      .hansora-language-floating{position:fixed;top:14px;right:14px;z-index:9999}
      .hansora-language-floating-button{height:38px;padding:0 13px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#12151e;color:#fff;font:850 12px/1 inherit;cursor:pointer;box-shadow:0 10px 35px rgba(0,0,0,.32)}
    `;
    document.head.appendChild(style);
  }

  function openLanguageSheet() {
    const backdrop = document.getElementById('hansoraLanguageSheet');
    if (backdrop) backdrop.classList.add('is-open');
  }

  function closeLanguageSheet() {
    const backdrop = document.getElementById('hansoraLanguageSheet');
    if (backdrop) backdrop.classList.remove('is-open');
  }

  function ensureLanguageSheet() {
    let backdrop = document.getElementById('hansoraLanguageSheet');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'hansoraLanguageSheet';
    backdrop.className = 'hansora-language-sheet-backdrop';
    backdrop.setAttribute('data-i18n-ignore', '');
    backdrop.innerHTML = `
      <section class="hansora-language-sheet" role="dialog" aria-modal="true" aria-label="Choose language">
        <div class="hansora-language-handle"></div>
        <div class="hansora-language-sheet-head">
          <div>
            <h2 class="hansora-language-sheet-title">Choose your language</h2>
            <p class="hansora-language-sheet-subtitle">Your choice will be saved across the website.</p>
          </div>
          <button class="hansora-language-sheet-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="hansora-language-options">
          <button class="hansora-language-option" type="button" data-hansora-language="en">
            <span class="hansora-language-flag">🇬🇧</span>
            <span class="hansora-language-copy"><strong>English</strong><small>English interface</small></span>
            <span class="hansora-language-check">✓</span>
          </button>
          <button class="hansora-language-option" type="button" data-hansora-language="ru">
            <span class="hansora-language-flag">🇷🇺</span>
            <span class="hansora-language-copy"><strong>Русский</strong><small>Интерфейс на русском</small></span>
            <span class="hansora-language-check">✓</span>
          </button>
        </div>
      </section>`;
    backdrop.querySelector('.hansora-language-sheet-close').addEventListener('click', closeLanguageSheet);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) closeLanguageSheet();
    });
    backdrop.querySelectorAll('[data-hansora-language]').forEach(function (button) {
      button.addEventListener('click', async function () {
        await setLanguage(button.dataset.hansoraLanguage);
        closeLanguageSheet();
      });
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function ensureSwitcher() {
    ensureStyles();
    ensureLanguageSheet();
    const accountMenu = document.querySelector('.site-header #navMenu');
    let row = document.getElementById('hansoraLanguageMenuRow');
    if (accountMenu && !row) {
      row = document.createElement('button');
      row.id = 'hansoraLanguageMenuRow';
      row.type = 'button';
      row.className = 'hansora-language-menu-row';
      row.setAttribute('data-i18n-ignore', '');
      row.innerHTML = `<span>Language</span><span class="hansora-language-current"><span data-hansora-language-name>English</span><span class="hansora-language-chevron">›</span></span>`;
      const logout = accountMenu.querySelector('#btnLogout');
      accountMenu.insertBefore(row, logout || null);
      row.addEventListener('click', function (event) {
        event.stopPropagation();
        accountMenu.classList.remove('is-open');
        openLanguageSheet();
      });
    }

    let floating = document.getElementById('hansoraLanguageFloating');
    if (!accountMenu && !floating) {
      floating = document.createElement('button');
      floating.id = 'hansoraLanguageFloating';
      floating.type = 'button';
      floating.className = 'hansora-language-floating hansora-language-floating-button';
      floating.setAttribute('data-i18n-ignore', '');
      floating.innerHTML = `🌐 <span data-hansora-language-name>English</span>`;
      floating.addEventListener('click', openLanguageSheet);
      document.body.appendChild(floating);
    } else if (accountMenu && floating) {
      floating.remove();
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

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeLanguageSheet();
  });
  document.addEventListener('click', closeMenus);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
