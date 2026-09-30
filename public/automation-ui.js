// Hansora Automation UI helpers shared by the signed-in pages: icons, count-up numbers, sliding tab
// indicator with scroll tracking, toasts and staggered entrance. No dependencies.
(function () {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const path = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icons = {
    instagram: path('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>'),
    comment: path('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>'),
    whatsapp: path('<path d="M20 11.6a8.1 8.1 0 0 1-12 7.1L4 20l1.3-3.8A8.1 8.1 0 1 1 20 11.6Z"/><path d="M9 8.5c0 3.3 2.6 6 6 6l1.2-1.4-2-1-1 .8a4 4 0 0 1-2.6-2.6l.8-1-1-2Z"/>'),
    phone: path('<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>'),
    chevron: path('<path d="m9 6 6 6-6 6"/>'),
    arrow: path('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    check: path('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    message: path('<path d="M4 5h16v11H8l-4 3.5V5Z"/>'),
    sparkle: path('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>'),
    handoff: path('<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M17 8h4M19 6l2 2-2 2"/>'),
    wallet: path('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/>'),
    calendar: path('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    bag: path('<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    spark: path('<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/>'),
    bell: path('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    book: path('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>'),
    shield: path('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>'),
    play: path('<path d="M7 5v14l12-7L7 5Z"/>'),
    send: path('<path d="M4 12 20 4l-6 16-2.5-6.5L4 12Z"/>'),
    edit: path('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    search: path('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    user: path('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'),
    branch: path('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 12h4a6 6 0 0 0 6-5M16 12h0"/>'),
    clock: path('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    eye: path('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    copy: path('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    trash: path('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    refresh: path('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>')
  };

  function icon(name) { return icons[name] || ''; }

  // Staggered entrance: each direct child of .ui-enter gets its own delay.
  function stagger(root = document) {
    root.querySelectorAll('.ui-enter').forEach(container => [...container.children].forEach((child, index) => child.style.setProperty('--i', Math.min(index, 12))));
  }

  function countUp(element, value, format = number => new Intl.NumberFormat().format(number), duration = 900) {
    if (!element) return;
    const target = Number(value) || 0;
    if (reduceMotion || target === 0) { element.textContent = format(target); return; }
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = format(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Background tabs pause animation frames; make sure the final number is always shown.
    setTimeout(() => { element.textContent = format(target); }, duration + 150);
  }

  // Tabs with a sliding underline. Anchor tabs (#section) also follow the scroll position.
  function tabs(nav) {
    if (!nav || nav.dataset.uiTabs) return;
    nav.dataset.uiTabs = '1';
    const indicator = document.createElement('span');
    indicator.className = 'ui-tabs-indicator';
    nav.appendChild(indicator);
    const items = () => [...nav.querySelectorAll('a,button')];
    const move = () => {
      const active = nav.querySelector('.active') || items()[0];
      if (!active) return;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    };
    const setActive = item => { items().forEach(other => other.classList.toggle('active', other === item)); move(); };
    nav.addEventListener('click', event => { const item = event.target.closest('a,button'); if (item && item.getAttribute('href')?.startsWith('#')) setActive(item); });
    const anchors = items().filter(item => item.getAttribute('href')?.startsWith('#'));
    if (anchors.length) {
      let ticking = false;
      const spy = () => {
        ticking = false;
        let current = anchors[0];
        for (const item of anchors) { const target = document.querySelector(item.getAttribute('href')); if (target && target.getBoundingClientRect().top < 140) current = item; }
        if (!current.classList.contains('active')) setActive(current);
      };
      window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    }
    window.addEventListener('resize', move);
    document.fonts?.ready.then(move);
    move(); setTimeout(move, 300);
    return { setActive, move };
  }

  let region;
  function toast(message, type = 'success', timeout = 3200) {
    if (!region) { region = document.createElement('div'); region.className = 'ui-toast-region'; region.setAttribute('aria-live', 'polite'); document.body.appendChild(region); }
    const item = document.createElement('div');
    item.className = `ui-toast${type === 'error' ? ' error' : ''}`;
    item.innerHTML = '<i></i><span></span>';
    item.querySelector('span').textContent = message;
    region.appendChild(item);
    setTimeout(() => { item.classList.add('leaving'); setTimeout(() => item.remove(), 260); }, timeout);
  }

  function typing() { const element = document.createElement('div'); element.className = 'ui-typing'; element.setAttribute('aria-label', 'Typing'); element.innerHTML = '<i></i><i></i><i></i>'; return element; }

  function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(element => { if (!element.dataset.iconDone) { element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon)); element.dataset.iconDone = '1'; } }); }

  // Full-screen "working on it" overlay for saves: busy('Saving…') shows or updates it, busy(false) hides it.
  let busyLayer = null;
  function busy(message) {
    if (message === false) { if (busyLayer) { busyLayer.classList.remove('show'); setTimeout(() => { if (busyLayer && !busyLayer.classList.contains('show')) busyLayer.hidden = true; }, 200); } return; }
    if (!busyLayer) {
      busyLayer = document.createElement('div');
      busyLayer.className = 'ui-busy'; busyLayer.setAttribute('role', 'status'); busyLayer.setAttribute('aria-live', 'polite');
      busyLayer.innerHTML = '<div class="ui-busy-card"><span class="ui-busy-spinner" aria-hidden="true"></span><strong class="ui-busy-text"></strong><small>Please keep this page open.</small></div>';
      document.body.appendChild(busyLayer);
    }
    busyLayer.querySelector('.ui-busy-text').textContent = String(message || 'Saving…');
    busyLayer.hidden = false; requestAnimationFrame(() => busyLayer.classList.add('show'));
  }

  window.HansoraUI = { icon, stagger, countUp, tabs, toast, typing, hydrateIcons, reduceMotion, busy };
  const ready = () => { hydrateIcons(); stagger(); document.querySelectorAll('.ui-tabs').forEach(tabs); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
