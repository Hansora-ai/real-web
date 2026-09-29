// The one header shared by every Hansora Automation page, including the light/dark switch (dark by default).
(function () {
  'use strict';
  const root = document.querySelector('[data-automation-header]');
  if (!root) return;
  const api = window.HansoraAutomation;
  const previewQuery = api?.isLocalPreview && window.location.protocol !== 'file:' ? '?preview=1' : '';
  const page = document.body.dataset.automationPage || 'landing';
  const appPage = !['landing', 'legal'].includes(page);
  const moon = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>';
  const sun = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
  const themeButton = `<button class="auto-theme" type="button" data-theme-toggle aria-label="Switch to light mode">${moon}${sun}</button>`;
  const mainLinks = appPage
    ? `<a href="automation-dashboard.html${previewQuery}"${page === 'dashboard' ? ' aria-current="page"' : ''}>AI employees</a><a href="automation.html${previewQuery}">Product</a>`
    : page === 'landing' ? `<a href="#channels">Channels</a><a href="#how-it-works">How it works</a><a href="#faq">FAQ</a>` : `<a href="automation.html${previewQuery}#channels">Channels</a><a href="automation.html${previewQuery}#how-it-works">How it works</a><a href="automation.html${previewQuery}#faq">FAQ</a>`;
  const authLabel = api?.isLocalPreview ? 'Dashboard' : 'Log in';
  const authHref = api?.isLocalPreview ? `automation-dashboard.html${previewQuery}` : '/login.html?returnTo=%2Fautomation-dashboard.html';
  root.innerHTML = `<header class="auto-header"><a class="auto-brand" href="automation.html${previewQuery}" aria-label="Hansora Automation home"><span>HANSORA</span><i>/</i><small>AUTOMATION</small></a><div class="auto-header-tools">${themeButton}<button class="auto-menu-toggle" type="button" aria-expanded="false" aria-controls="automation-nav" aria-label="Open navigation"><span></span><span></span></button></div><nav id="automation-nav" aria-label="Main navigation">${mainLinks}<span class="auto-divider" aria-hidden="true"></span><a class="auto-back" href="/">Hansora Creative ↗</a>${appPage ? '' : `<a class="auto-auth-link" href="${authHref}">${authLabel}</a>`}${themeButton}${['dashboard','setup'].includes(page) ? '' : `<a class="auto-cta" href="automation-setup.html${previewQuery}">${appPage ? 'New AI employee' : 'Get started'}</a>`}</nav></header>`;

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
      ['workflows', 'Automations', 'comment', q ? `automation-workflows.html?${q}` : '', ['comments']],
      ['operations', 'Orders & bookings', 'bag', q ? `automation-operations.html?${q}` : ''],
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
  }

  if (!appPage && api && typeof api.getUser === 'function') {
    api.getUser().then(user => {
      const authLink = root.querySelector('.auto-auth-link');
      if (!authLink || !user) return;
      authLink.textContent = 'Dashboard';
      authLink.href = 'automation-dashboard.html';
    }).catch(() => {});
  }
})();
