// The one header shared by every Hansora Automation page, including the light/dark switch (dark by default).
(function () {
  'use strict';
  const root = document.querySelector('[data-automation-header]');
  if (!root) return;
  const api = window.HansoraAutomation;
  const previewQuery = api?.isLocalPreview && window.location.protocol !== 'file:' ? '?preview=1' : '';
  const page = document.body.dataset.automationPage || 'landing';
  const appPage = !['landing', 'legal', 'pricing'].includes(page);
  const moon = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>';
  const sun = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
  const themeButton = `<button class="auto-theme" type="button" data-theme-toggle aria-label="Switch to light mode">${moon}${sun}</button>`;
  const mainLinks = appPage
    ? `<a href="automation-dashboard.html${previewQuery}"${page === 'dashboard' ? ' aria-current="page"' : ''}>AI employees</a><a href="automation.html${previewQuery}">Product</a>`
    : page === 'landing' ? `<a href="#channels">Channels</a><a href="#how-it-works">How it works</a><a href="automation-pricing.html${previewQuery}">Pricing</a><a href="#faq">FAQ</a>` : `<a href="automation.html${previewQuery}#channels">Channels</a><a href="automation.html${previewQuery}#how-it-works">How it works</a><a href="automation-pricing.html${previewQuery}"${page === 'pricing' ? ' aria-current="page"' : ''}>Pricing</a><a href="automation.html${previewQuery}#faq">FAQ</a>`;
  // Account area: the same login window, credits and photo as the Hansora Creative header (header.js fills these ids).
  const realSite = !api?.isLocalPreview;
  let cachedLoggedIn = false;
  try { cachedLoggedIn = localStorage.getItem('hansora.header.loggedIn') === '1'; } catch (_) {}
  const accountArea = realSite
    ? `<span class="auto-account"><button class="auto-auth-link" type="button" id="btnLoginSignup" style="display:${cachedLoggedIn ? 'none' : 'inline-flex'}">Log in</button><span class="auto-credits" id="navCredits" title="Your credits" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}"></span><button class="auto-avatar" type="button" id="navAvatar" aria-label="Open account menu" style="display:${cachedLoggedIn ? 'inline-flex' : 'none'}"><img id="navAvatarImg" alt="" src="https://ui-avatars.com/api/?name=H&background=6366f1&color=fff"></button></span>`
    : (appPage ? '' : `<a class="auto-auth-link" href="automation-dashboard.html${previewQuery}">Dashboard</a>`);
  const accountMenu = realSite ? `<div class="auto-user-menu" id="navMenu"><a href="automation-dashboard.html">AI employees</a><a href="automation-profile.html">Profile</a><a href="automation-pricing.html">Buy credits</a><a href="/">Hansora Creative</a><button type="button" id="autoLogout">Log out</button></div>` : '';
  root.innerHTML = `<header class="auto-header"><a class="auto-brand" href="automation.html${previewQuery}" aria-label="Hansora Automation home"><span>HANSORA</span><i>/</i><small>AUTOMATION</small></a><div class="auto-header-tools">${themeButton}<button class="auto-menu-toggle" type="button" aria-expanded="false" aria-controls="automation-nav" aria-label="Open navigation"><span></span><span></span></button></div><nav id="automation-nav" aria-label="Main navigation">${mainLinks}<span class="auto-divider" aria-hidden="true"></span><a class="auto-back" href="/">Hansora Creative ↗</a>${themeButton}${['dashboard','setup'].includes(page) ? '' : `<a class="auto-cta" href="automation-setup.html${previewQuery}">${appPage ? 'New AI employee' : 'Get started'}</a>`}${accountArea}</nav>${accountMenu}</header>`;

  const syncThemeLabels = () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    root.querySelectorAll('[data-theme-toggle]').forEach(button => button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f7f7f8' : '#08090b');
  };
  syncThemeLabels();
  root.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    const html = document.documentElement;
    html.classList.add('theme-switching');
    html.setAttribute('data-theme', next);
    try { localStorage.setItem('hansora_automation_theme', next); } catch (_) {}
    syncThemeLabels();
    setTimeout(() => html.classList.remove('theme-switching'), 350);
  }));

  const toggle = root.querySelector('.auto-menu-toggle');
  const close = () => { toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Open navigation'); root.classList.remove('menu-open'); };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    root.classList.toggle('menu-open', open);
  });
  root.querySelectorAll('nav a').forEach(link => link.addEventListener('click', close));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  // Shared left sidebar for every signed-in Automation page (like ManyChat): one place to edit it.
  if (appPage) renderSidebar();
  function renderSidebar() {
    const params = new URLSearchParams(location.search);
    const storeKey = 'hansora_automation_business';
    let businessId = params.get('business') || (['agent', 'setup'].includes(page) ? params.get('id') : '') || '';
    if (!businessId && api?.isLocalPreview) businessId = 'preview';
    try { if (businessId) localStorage.setItem(storeKey, businessId); else businessId = localStorage.getItem(storeKey) || ''; } catch (_) {}
    if (businessId && !/^([0-9a-f-]{36}|preview)$/i.test(businessId)) businessId = '';
    const preview = api?.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : '';
    const q = businessId ? `business=${encodeURIComponent(businessId)}${preview}` : '';
    const icon = name => window.HansoraUI?.icon(name) || '';
    const items = [
      ['agent', 'Overview', 'sparkle', q ? `automation-agent.html?id=${encodeURIComponent(businessId)}${preview}` : ''],
      ['inbox', 'Inbox', 'message', q ? `automation-inbox.html?${q}` : ''],
      ['contacts', 'Contacts', 'user', q ? `automation-contacts.html?${q}` : ''],
      ['workflows', 'Automations', 'comment', q ? `automation-workflows.html?${q}` : '', ['comments']],
      ['operations', 'Orders & bookings', 'bag', q ? `automation-operations.html?${q}` : ''],
      ['products', 'Products', 'box', q ? `automation-products.html?${q}` : ''],
      ['tools', 'Business tools', 'spark', q ? `automation-tools.html?${q}` : ''],
      ['connect', 'Channels', 'instagram', q ? `automation-agent.html?id=${encodeURIComponent(businessId)}${preview}#channels` : ''],
      ['phone', 'Phone calls', 'phone', q ? `automation-phone.html?${q}` : ''],
      ['usage', 'Usage & credits', 'wallet', q ? `automation-usage.html?${q}` : '']
    ];
    const link = ([key, label, iconName, href, also = []]) => {
      const active = page === key || also.includes(page);
      return href ? `<a href="${href}" class="auto-side-link${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''} title="${label}">${icon(iconName)}<span>${label}</span></a>`
        : `<span class="auto-side-link disabled" title="Choose an AI employee first">${icon(iconName)}<span>${label}</span></span>`;
    };
    const aside = document.createElement('aside');
    aside.className = 'auto-sidebar';
    aside.setAttribute('aria-label', 'Automation sections');
    aside.innerHTML = `<nav>${items.map(link).join('')}</nav><div class="auto-side-foot">${link(['dashboard', 'AI employees', 'user', `automation-dashboard.html${api?.isLocalPreview && location.protocol !== 'file:' ? '?preview=1' : ''}`])}${businessId && businessId !== 'preview' || api?.isLocalPreview ? link(['setup', 'Edit AI employee', 'edit', `automation-setup.html?id=${encodeURIComponent(businessId)}${preview}`]) : ''}<button class="auto-side-link auto-side-collapse" type="button" aria-label="Collapse sidebar">${icon('chevron')}<span>Collapse</span></button></div>`;
    document.body.appendChild(aside);
    document.body.classList.add('has-auto-sidebar');
    let collapsed = false;
    try { collapsed = localStorage.getItem('hansora_automation_sidebar') === 'collapsed'; } catch (_) {}
    const applyCollapsed = () => { document.body.classList.toggle('auto-sidebar-collapsed', collapsed); aside.querySelector('.auto-side-collapse span').textContent = collapsed ? 'Expand' : 'Collapse'; };
    applyCollapsed();
    aside.querySelector('.auto-side-collapse').addEventListener('click', () => { collapsed = !collapsed; try { localStorage.setItem('hansora_automation_sidebar', collapsed ? 'collapsed' : 'open'); } catch (_) {} applyCollapsed(); });
    // Phones: the same sections appear inside the header menu.
    const mobile = document.createElement('div');
    mobile.className = 'auto-mobile-sections';
    mobile.innerHTML = items.filter(item => item[3]).map(link).join('');
    root.querySelector('nav')?.prepend(mobile);
    renderSwitcher(businessId, preview);
    renderBottomBar(items, businessId, preview);
  }

  // Which AI employee you are working on, and a quick way to change it: same page, other employee.
  function renderSwitcher(businessId, preview) {
    const icon = name => window.HansoraUI?.icon(name) || '';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const CACHE = 'hansora_automation_employees';
    const make = () => { const box = document.createElement('div'); box.className = 'auto-switch'; return box; };
    const boxes = [make(), make()];
    document.querySelector('.auto-sidebar')?.prepend(boxes[0]);
    document.querySelector('.auto-mobile-sections')?.prepend(boxes[1]);
    const targetFor = id => {
      const url = new URL(location.href);
      const keep = preview ? '&preview=1' : '';
      if (['agent', 'setup'].includes(page)) return `${url.pathname.replace(/^\//, '')}?id=${encodeURIComponent(id)}${keep}${url.hash}`;
      if (page === 'comments') return `automation-workflows.html?business=${encodeURIComponent(id)}${keep}`;
      if (!/automation-[a-z]+\.html/.test(url.pathname) || page === 'dashboard') return `automation-agent.html?id=${encodeURIComponent(id)}${keep}`;
      return `${url.pathname.replace(/^\//, '')}?business=${encodeURIComponent(id)}${keep}`;
    };
    const render = list => {
      const current = list.find(item => item.id === businessId);
      const label = current ? (current.ig || current.name) : 'Choose an AI employee';
      const sub = current ? (current.ig ? current.name : 'No Instagram connected') : `${list.length} AI employee${list.length === 1 ? '' : 's'}`;
      boxes.forEach(box => {
        const open = box.classList.contains('open');
        box.innerHTML = `<button class="auto-switch-button" type="button" aria-haspopup="menu" aria-expanded="${open}" title="Change AI employee"><span class="auto-switch-ig">${icon('instagram')}</span><span class="auto-switch-text"><b>${escape(label)}</b><small>${escape(sub)}</small></span><span class="auto-switch-chev" aria-hidden="true">⌄</span></button><div class="auto-switch-menu" role="menu"${open ? '' : ' hidden'}>${list.map(item => `<a role="menuitem" href="${escape(targetFor(item.id))}" class="${item.id === businessId ? 'current' : ''}"><span class="auto-switch-ig sm">${icon('instagram')}</span><span><b>${escape(item.ig || item.name)}</b><small>${escape(item.ig ? item.name : 'No Instagram connected')}</small></span>${item.id === businessId ? '<i aria-hidden="true">✓</i>' : ''}</a>`).join('')}<a role="menuitem" class="auto-switch-new" href="automation-setup.html${preview ? '?preview=1' : ''}">+ New AI employee</a></div>`;
        box.querySelector('.auto-switch-button').addEventListener('click', event => { event.stopPropagation(); const now = !box.classList.contains('open'); box.classList.toggle('open', now); box.querySelector('.auto-switch-menu').hidden = !now; event.currentTarget.setAttribute('aria-expanded', String(now)); });
      });
    };
    document.addEventListener('click', event => { boxes.forEach(box => { if (!box.contains(event.target) && box.classList.contains('open')) { box.classList.remove('open'); box.querySelector('.auto-switch-menu').hidden = true; box.querySelector('.auto-switch-button').setAttribute('aria-expanded', 'false'); } }); });
    let cached = [];
    try { cached = JSON.parse(sessionStorage.getItem(CACHE) || '[]'); } catch (_) {}
    render(cached);
    if (api?.isLocalPreview) return render([{ id: 'preview', name: 'Luma Assistant', ig: '@luma.studio' }, { id: 'preview-2', name: 'Second shop', ig: '' }]);
    api?.db?.from('automation_businesses').select('id,name,updated_at,automation_agents(display_name),automation_channel_connections(channel_type,status,connected_account_label)').order('updated_at', { ascending: false }).then(({ data }) => {
      if (!Array.isArray(data)) return;
      const list = data.map(row => {
        const agent = Array.isArray(row.automation_agents) ? row.automation_agents[0] : row.automation_agents;
        const label = (row.automation_channel_connections || []).find(item => item.channel_type === 'instagram_dm' && item.status !== 'not_connected' && item.connected_account_label)?.connected_account_label || '';
        return { id: row.id, name: agent?.display_name || row.name || 'AI employee', ig: label ? (label.startsWith('@') ? label : `@${label}`) : '' };
      });
      try { sessionStorage.setItem(CACHE, JSON.stringify(list)); } catch (_) {}
      render(list);
    }).catch(() => {});
  }

  // Phones: a bottom bar like Hansora Creative's (Home, Employees, Inbox, Menu); the header keeps credits and the photo.
  function renderBottomBar(items, businessId, preview) {
    const icon = name => window.HansoraUI?.icon(name) || '';
    const hrefOf = key => items.find(item => item[0] === key)?.[3] || '';
    const employees = `automation-dashboard.html${api?.isLocalPreview && location.protocol !== 'file:' ? '?preview=1' : ''}`;
    const tab = (key, label, iconName, href, active) => `<a class="auto-tab${active ? ' active' : ''}" href="${href || employees}"${active ? ' aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`;
    const bar = document.createElement('nav');
    bar.className = 'auto-bottom-nav';
    bar.setAttribute('aria-label', 'Automation navigation');
    bar.innerHTML = `${tab('agent', 'Home', 'sparkle', hrefOf('agent'), page === 'agent')}${tab('dashboard', 'Employees', 'user', employees, page === 'dashboard')}${tab('inbox', 'Inbox', 'message', hrefOf('inbox'), page === 'inbox')}<button class="auto-tab" type="button" data-bottom-menu aria-expanded="false"><span class="auto-tab-burger" aria-hidden="true"><i></i><i></i><i></i></span><span>Menu</span></button>`;
    document.body.appendChild(bar);
    document.body.classList.add('has-auto-bottom-nav');
    const menuButton = bar.querySelector('[data-bottom-menu]');
    menuButton.addEventListener('click', () => { root.querySelector('.auto-menu-toggle')?.click(); menuButton.setAttribute('aria-expanded', String(root.classList.contains('menu-open'))); });
    // Credits and the photo stay visible in the phone header (header.js fills the same elements).
    const account = root.querySelector('.auto-account'); const tools = root.querySelector('.auto-header-tools'); const nav = root.querySelector('nav');
    const phone = window.matchMedia('(max-width:760px)');
    const place = () => { if (!account || !tools || !nav) return; if (phone.matches) tools.insertBefore(account, tools.querySelector('.auto-menu-toggle')); else nav.appendChild(account); };
    place(); phone.addEventListener?.('change', place);
  }

  if (realSite) connectHansoraAccount();
  function connectHansoraAccount() {
    const RETURN_KEY = 'hansora.automation.auth_return.v1';
    const params = new URLSearchParams(location.search);
    const safePath = value => /^\/automation(?:-[a-z]+)?(?:\.html)?(?:[?#][^\s]*)?$/.test(String(value || '')) ? String(value) : '';
    // Where to go after logging in: the page that asked for it, or the dashboard from the landing page.
    const remember = path => { try { localStorage.setItem(RETURN_KEY, JSON.stringify({ path, createdAt: Date.now() })); } catch (_) {} };
    const destination = () => safePath(params.get('returnTo')) || (page === 'landing' || page === 'legal' ? '/automation-dashboard.html' : location.pathname + location.search);
    root.querySelector('#btnLoginSignup')?.addEventListener('click', () => remember(destination()));
    root.querySelector('#autoLogout')?.addEventListener('click', async () => {
      try { await window.__HANSORA_SB__?.auth.signOut(); } catch (_) {}
      try { localStorage.setItem('hansora.header.loggedIn', '0'); } catch (_) {}
      location.href = 'automation.html';
    });
    const wanted = params.get('login');
    if (wanted) remember(destination());
    // header.js brings the Creative login window (Google, Telegram, email), sessions, new-profile setup and credits.
    if (!document.querySelector('link[href="/header.css"]')) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/header.css'; document.head.appendChild(css); }
    const script = document.createElement('script');
    script.src = '/header.js';
    script.onload = () => {
      if (!wanted) return;
      let tries = 0;
      const open = () => {
        const header = window.HansoraHeader;
        if (header?.getCurrentUser?.()) return;
        if (header?.openAuth) return header.openAuth(wanted === 'signup' ? 'signup' : 'login');
        if (++tries < 40) setTimeout(open, 100);
      };
      // Give the saved session a moment to load, so signed-in visitors are sent on instead of seeing the window.
      setTimeout(open, 600);
    };
    document.body.appendChild(script);
    if (page === 'landing' && api && typeof api.getUser === 'function') {
      api.getUser().then(user => {
        const cta = root.querySelector('.auto-cta');
        if (!cta || !user) return;
        cta.textContent = 'Dashboard';
        cta.href = 'automation-dashboard.html';
      }).catch(() => {});
    }
  }
})();
