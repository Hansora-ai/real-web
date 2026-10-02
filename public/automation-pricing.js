(function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const DISPLAY = 10; // stored credits ×10 = ⚡ shown everywhere on Hansora
  const PRICE_PER_AI_REPLY = 1; // ⚡
  const PRICE_PER_PHONE_MINUTE = 8; // ⚡
  // credits/bonus are stored credits (what the payment adds to profiles.credits). A pack is only buyable once its
  // Dodo product exists: products for $49.99 and $99.99 are the same ones Hansora Creative sells.
  const PACKS = [
    { id: 'starter', name: 'Starter', price: 14.99, credits: 150, bonus: 0, product: '', note: 'Try it on one channel' },
    { id: 'growth', name: 'Growth', price: 24.99, credits: 250, bonus: 15, product: '', note: 'For a busy Instagram', popular: true },
    { id: 'business', name: 'Business', price: 49.99, credits: 500, bonus: 35, product: 'https://checkout.dodopayments.com/buy/pdt_oVJI6GNjziGZKrXtVczUY', note: 'Instagram + WhatsApp + calls' },
    { id: 'scale', name: 'Scale', price: 99.99, credits: 1000, bonus: 100, product: 'https://checkout.dodopayments.com/buy/pdt_e8UPGoRi6Sf36NoxV7fAF', note: 'Several AI employees' }
  ];
  const fmt = new Intl.NumberFormat('en-US');
  const base = PACKS[0].price / ((PACKS[0].credits + PACKS[0].bonus) * DISPLAY);

  const grid = document.querySelector('#pricing-packs');
  grid.innerHTML = PACKS.map(pack => {
    const total = (pack.credits + pack.bonus) * DISPLAY;
    const save = Math.round((1 - pack.price / total / base) * 100);
    const minutes = Math.floor(total / PRICE_PER_PHONE_MINUTE);
    return `<article class="ui-card ui-pack${pack.popular ? ' popular' : ''}">
      ${pack.popular ? '<span class="ui-pack-flag">Most popular</span>' : ''}
      <div class="ui-pack-head"><h2>${pack.name}</h2><p>${pack.note}</p></div>
      <div class="ui-pack-price"><strong>$${pack.price.toFixed(2)}</strong>${save > 0 ? `<span class="ui-badge green">Save ${save}%</span>` : '<span class="ui-pack-once">one-time</span>'}</div>
      <div class="ui-pack-credits"><b>${fmt.format(total)}⚡</b>${pack.bonus ? `<small>${fmt.format(pack.credits * DISPLAY)}⚡ + ${fmt.format(pack.bonus * DISPLAY)}⚡ bonus</small>` : '<small>credits</small>'}</div>
      <ul class="ui-pack-list">
        <li>${ui?.icon('message') || ''}<span><b>≈ ${fmt.format(Math.floor(total / PRICE_PER_AI_REPLY))}</b> AI replies on Instagram &amp; WhatsApp</span></li>
        <li>${ui?.icon('phone') || ''}<span>or <b>≈ ${fmt.format(minutes)}</b> phone call minutes</span></li>
        <li>${ui?.icon('comment') || ''}<span>Comment &amp; DM automations <b>included</b></span></li>
        <li>${ui?.icon('check') || ''}<span>Inbox, contacts, orders &amp; bookings</span></li>
      </ul>
      <button class="ui-btn ${pack.popular ? 'primary' : 'secondary'} ui-pack-buy" type="button" data-pack="${pack.id}" ${pack.product ? '' : 'data-soon="1"'}>${pack.product ? `Buy ${fmt.format(total)}⚡` : 'Available soon'}</button>
    </article>`;
  }).join('');
  ui?.stagger?.(document);

  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-pack]');
    if (!button) return;
    const pack = PACKS.find(item => item.id === button.dataset.pack);
    if (pack) openCheckout(pack, button);
  });
  window.addEventListener('pageshow', () => document.querySelectorAll('.ui-pack-buy[aria-busy="true"]').forEach(resetButton));

  function resetButton(button) { button.removeAttribute('aria-busy'); button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; }

  async function openCheckout(pack, button) {
    if (!pack.product) return ui?.toast('This pack opens very soon. Please choose another one for now.', 'info');
    if (button.getAttribute('aria-busy') === 'true') return;
    if (api?.isLocalPreview) return ui?.toast('Checkout is disabled in preview.', 'info');
    const user = await api.getUser().catch(() => null);
    if (!user?.id) {
      // Log in first (Google, Telegram or email) and come back to this page.
      try { localStorage.setItem('hansora.automation.auth_return.v1', JSON.stringify({ path: '/automation-pricing.html', createdAt: Date.now() })); } catch (_) {}
      if (window.HansoraHeader?.openAuth) return window.HansoraHeader.openAuth('signup');
      return location.assign('/automation.html?login=signup&returnTo=%2Fautomation-pricing.html');
    }
    button.dataset.label = button.textContent; button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = 'Opening checkout…';
    try {
      const url = new URL(pack.product);
      url.searchParams.set('quantity', '1');
      url.searchParams.set('redirect_url', 'https://hansora.co/automation-profile.html?checkout=success');
      Object.entries(await checkoutDefaults(user)).forEach(([key, value]) => url.searchParams.set(key, value));
      url.searchParams.set('minimalAddress', 'true');
      url.searchParams.set('metadata_uid', user.id);
      const email = checkoutEmail(user);
      if (email) { url.searchParams.set('email', email); url.searchParams.set('metadata_email', email); }
      url.searchParams.set('metadata_credits', String(pack.credits + pack.bonus));
      url.searchParams.set('metadata_source', 'automation');
      location.href = url.toString();
    } catch (error) {
      console.error('Unable to open checkout.', error);
      resetButton(button);
      ui?.toast('The checkout could not open. Please try again.', 'error');
    }
  }

  // Same rules as the Hansora Creative pricing page.
  function isTelegramUser(user) {
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    const provider = String(user?.app_metadata?.provider || '').toLowerCase();
    return provider === 'telegram' || provider === 'custom:telegram' || identities.some(identity => ['telegram', 'custom:telegram'].includes(String(identity?.provider || '').toLowerCase()) || identity?.identity_data?.iss === 'https://oauth.telegram.org') || user?.user_metadata?.iss === 'https://oauth.telegram.org';
  }
  function checkoutEmail(user) {
    if (!user || isTelegramUser(user)) return '';
    const email = String(user.email || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }
  async function checkoutDefaults(user) {
    let country = '';
    try {
      const sb = window.__HANSORA_SB__;
      if (sb && user.email) {
        const { data } = await sb.from('registration_attributions').select('country_code').eq('email', user.email).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
        country = String(data?.country_code || '').trim().toUpperCase();
      }
    } catch (_) {}
    return country === 'AM' ? { forceLanguage: 'ru', country: 'AM', zipCode: '0012' } : { forceLanguage: 'en' };
  }
})();
