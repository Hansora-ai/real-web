(function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const DISPLAY = 10; // stored credits ×10 = ⚡ shown everywhere on Hansora
  const YOOMONEY_RECEIVER = '4100119285004528';
  const RU_SUCCESS_URL = 'https://hansora.co/russian-payment-success.html';

  // Prices per action in ⚡. Must match lib/automation/billing.mjs (automationPrices and AUTOMATION_PLANS).
  const PAYG_RATES = { aiReply: 1.2, mediaReply: 2, voiceReply: 1, commentRun: 1, voiceMinute: 8 };
  const PAYG_DISCOUNT = 0.3; // shown as the pay-as-you-go sale, like the Hansora Creative pricing page

  // Pay as you go. credits/bonus are stored credits (what the payment adds to profiles.credits). rub must match
  // PACKS in netlify/functions/yoomoney-webhook.mjs. A card pack is buyable once its Dodo product exists.
  const PACKS = [
    { id: 'starter', name: 'Starter', price: 14.99, rub: 1100, credits: 150, bonus: 0, product: 'https://checkout.dodopayments.com/buy/pdt_0NpePPSth80ohulWU0r3D', note: 'Try it on one channel' },
    { id: 'growth', name: 'Growth', price: 24.99, rub: 1850, credits: 250, bonus: 15, product: 'https://checkout.dodopayments.com/buy/pdt_0NpeQ0zMDMcghYvelVXBm', note: 'For a busy Instagram', popular: true },
    { id: 'business', name: 'Business', price: 49.99, rub: 3700, credits: 500, bonus: 35, product: 'https://checkout.dodopayments.com/buy/pdt_oVJI6GNjziGZKrXtVczUY', note: 'Several channels and calls' },
    { id: 'scale', name: 'Scale', price: 99.99, rub: 7400, credits: 1000, bonus: 100, product: 'https://checkout.dodopayments.com/buy/pdt_e8UPGoRi6Sf36NoxV7fAF', note: 'Several AI employees' }
  ];

  // Monthly plans (Dodo subscriptions). credits = ⚡ added every paid month. product = the Dodo subscription link.
  const PLANS = [
    { id: 'automation_starter_monthly', name: 'Starter', price: 49, credits: 4900, product: 'https://checkout.dodopayments.com/buy/pdt_0NpeQYSDnUbMHvi9Gt6yy', note: 'One busy shop', rates: { aiReply: 1, mediaReply: 2, voiceReply: 1, commentRun: 1, voiceMinute: 8 } },
    { id: 'automation_growth_monthly', name: 'Growth', price: 99, credits: 9900, product: 'https://checkout.dodopayments.com/buy/pdt_0NpeQrUC5gB5c3Jk8zZE9', note: 'Lots of Instagram comments', popular: true, rates: { aiReply: 1, mediaReply: 2, voiceReply: 1, commentRun: 0.5, voiceMinute: 7 } },
    { id: 'automation_business_monthly', name: 'Business', price: 149, credits: 14900, product: 'https://checkout.dodopayments.com/buy/pdt_0NpeR55QAhlX4ViGBTCF4', note: 'Every channel and phone calls', rates: { aiReply: 0.9, mediaReply: 2, voiceReply: 1, commentRun: 0.5, voiceMinute: 7 } },
    { id: 'automation_scale_monthly', name: 'Scale', price: 199, credits: 19900, product: 'https://checkout.dodopayments.com/buy/pdt_0NpeRJQYrPCPCIK9zbEb1', note: 'Agencies and high volume', rates: { aiReply: 0.8, mediaReply: 2, voiceReply: 1, commentRun: 0.3, voiceMinute: 6 } }
  ];

  const fmt = new Intl.NumberFormat('en-US');
  const zap = value => `${fmt.format(value)}⚡`;
  const main = document.querySelector('.ui-pricing');
  const packsGrid = document.querySelector('#pricing-packs');
  const plansGrid = document.querySelector('#pricing-plans');
  let mode = 'payg'; let payment = 'international'; let subscription = null;

  const icon = name => ui?.icon(name) || '';
  const li = (name, html) => `<li>${icon(name)}<span>${html}</span></li>`;
  const usd = value => `$${value.toFixed(value % 1 ? 2 : 0)}`;

  // What the ⚡ buy, one line per kind of work ("or": they share the same balance).
  function capacity(zaps, rates) {
    const count = rate => fmt.format(Math.floor(zaps / rate + 1e-9));
    return `<div class="ui-pack-capacity"><p>Enough for about</p><ul>
      <li>${icon('message')}<b>${count(rates.aiReply)}</b><span>AI replies</span></li>
      <li>${icon('comment')}<b>${count(rates.commentRun)}</b><span>comments</span></li>
      <li>${icon('phone')}<b>${count(rates.voiceMinute)}</b><span>call minutes</span></li>
      <li>${icon('eye')}<b>${count(rates.mediaReply)}</b><span>photo / video replies</span></li>
      <li>${icon('play')}<b>${count(rates.voiceReply)}</b><span>voice replies</span></li>
    </ul><small>Mix them as you like – one balance.</small></div>`;
  }

  function renderPacks() {
    const ru = payment === 'ru';
    packsGrid.innerHTML = PACKS.map(pack => {
      const total = (pack.credits + pack.bonus) * DISPLAY;
      const price = ru ? `${fmt.format(pack.rub)} ₽` : `$${pack.price.toFixed(2)}`;
      const was = ru ? `${fmt.format(Math.round(pack.rub / (1 - PAYG_DISCOUNT) / 10) * 10)} ₽` : usd(pack.price / (1 - PAYG_DISCOUNT));
      const soon = !ru && !pack.product;
      return `<article class="ui-card ui-pack${pack.popular ? ' popular' : ''}">
        ${pack.popular ? '<span class="ui-pack-flag">Most popular</span>' : ''}
        <div class="ui-pack-head"><h2>${pack.name}</h2><p>${pack.note}</p></div>
        <div class="ui-pack-pricing"><div class="ui-pack-was"><s>${was}</s><span class="ui-badge green">Save ${Math.round(PAYG_DISCOUNT * 100)}%</span></div>
          <div class="ui-pack-price"><strong>${price}</strong><span class="ui-pack-once">one-time</span></div></div>
        <button class="ui-btn ui-pack-buy" type="button" data-pack="${pack.id}"${soon ? ' data-soon' : ''}>${soon ? 'Available soon' : 'Buy'}</button>
        <div class="ui-pack-credits"><b>${zap(total)}</b>${pack.bonus ? `<small>${zap(pack.credits * DISPLAY)} + <em>${zap(pack.bonus * DISPLAY)} bonus</em> · never expire</small>` : '<small>credits that never expire</small>'}</div>
        ${capacity(total, PAYG_RATES)}
        <ul class="ui-pack-list">${li('check', 'Unlimited AI employees, every channel')}</ul>
      </article>`;
    }).join('');
  }

  function renderPlans() {
    const current = activePlan();
    plansGrid.innerHTML = PLANS.map(plan => {
      const isCurrent = current?.plan_id === plan.id;
      const soon = !plan.product;
      const save = Math.round((1 - plan.rates.aiReply / PAYG_RATES.aiReply) * 100);
      // Honest "was" price: what the same number of AI replies costs with pay-as-you-go ⚡ ($1 = 100⚡).
      const worth = plan.credits / plan.rates.aiReply * PAYG_RATES.aiReply / 100;
      const off = Math.round((1 - plan.price / worth) * 100);
      return `<article class="ui-card ui-pack ui-plan${plan.popular ? ' popular' : ''}${isCurrent ? ' current' : ''}">
        ${isCurrent ? '<span class="ui-pack-flag current">Your plan</span>' : plan.popular ? '<span class="ui-pack-flag">Most popular</span>' : ''}
        <div class="ui-pack-head"><h2>${plan.name}</h2><p>${plan.note}</p></div>
        <div class="ui-pack-pricing"><div class="ui-pack-was">${worth > plan.price ? `<s>${usd(Math.round(worth))}</s>` : ''}${off > 0 ? `<span class="ui-badge green">Save ${off}%</span>` : ''}</div>
          <div class="ui-pack-price"><strong>$${plan.price}</strong><span class="ui-pack-once">/ month</span></div></div>
        <button class="ui-btn ui-pack-buy" type="button" data-plan="${plan.id}"${soon && !isCurrent ? ' data-soon' : ''}${isCurrent ? ' disabled' : ''}>${isCurrent ? 'Current plan' : soon ? 'Available soon' : 'Buy'}</button>
        <div class="ui-pack-credits"><b>${zap(plan.credits)}</b><small>every month · cancel any time</small></div>
        ${capacity(plan.credits, plan.rates)}
        <ul class="ui-pack-list">
          ${li('message', `AI reply <b>${zap(plan.rates.aiReply)}</b>${save > 0 ? ` <span class="ui-plan-save">−${save}%</span>` : ''}`)}
          ${li('comment', `Comment automation <b>${zap(plan.rates.commentRun)}</b>${plan.rates.commentRun < PAYG_RATES.commentRun ? ` <span class="ui-plan-save">−${Math.round((1 - plan.rates.commentRun / PAYG_RATES.commentRun) * 100)}%</span>` : ''}`)}
          ${li('phone', `Phone call <b>${zap(plan.rates.voiceMinute)}</b> / min${plan.rates.voiceMinute < PAYG_RATES.voiceMinute ? ` <span class="ui-plan-save">−${Math.round((1 - plan.rates.voiceMinute / PAYG_RATES.voiceMinute) * 100)}%</span>` : ''}`)}
          ${li('check', 'Unlimited AI employees, every channel')}
        </ul>
      </article>`;
    }).join('');
  }

  function renderRates() {
    const rows = [
      ['AI reply', 'An answer written by your AI employee in any chat', 'aiReply', ''],
      ['Photo or video reply', 'The customer sent a photo or a video and the AI looked at it', 'mediaReply', ''],
      ['Voice message reply', 'The customer sent a voice message and the AI listened to it', 'voiceReply', ''],
      ['Comment automation', 'One person going through one comment automation: public reply, DMs, buttons and links together', 'commentRun', ' / run'],
      ['Phone call', 'Per minute of conversation', 'voiceMinute', ' / min']
    ];
    const head = `<thead><tr><th scope="col"></th><th scope="col">Pay as you go</th>${PLANS.map(plan => `<th scope="col">${plan.name}<small>$${plan.price}/mo</small></th>`).join('')}</tr></thead>`;
    const body = rows.map(([label, hint, key, unit]) => `<tr><th scope="row"><strong>${label}</strong><small>${hint}</small></th><td>${zap(PAYG_RATES[key])}${unit}</td>${PLANS.map(plan => `<td class="${plan.rates[key] < PAYG_RATES[key] ? 'cheaper' : ''}">${zap(plan.rates[key])}${unit}</td>`).join('')}</tr>`).join('')
      + `<tr><th scope="row"><strong>DM automations</strong><small>Keyword, story reply and other DM automations</small></th><td class="free" colspan="${PLANS.length + 1}">Free</td></tr>`
      + `<tr><th scope="row"><strong>Replies you send yourself</strong><small>From the Hansora inbox or your phone</small></th><td class="free" colspan="${PLANS.length + 1}">Free</td></tr>`;
    document.querySelector('#rate-table').innerHTML = head + `<tbody>${body}</tbody>`;
  }

  function renderCurrent() {
    const box = document.querySelector('#current-plan');
    const current = activePlan(); const plan = PLANS.find(item => item.id === current?.plan_id);
    box.hidden = !plan; if (!plan) return;
    const end = current.current_period_end ? new Date(current.current_period_end).toLocaleDateString([], { day: 'numeric', month: 'long' }) : '';
    box.innerHTML = `<div><b>You are on ${plan.name}</b><p>${current.cancel_at_period_end ? `Cancelled · active until ${end}` : `${zap(plan.credits)} every month${end ? ` · renews ${end}` : ''}`}</p></div>${current.cancel_at_period_end ? '' : '<button class="ui-btn ghost sm" type="button" id="cancel-plan">Cancel plan</button>'}`;
  }

  function render() {
    main.dataset.pricingMode = mode; main.dataset.payment = payment;
    document.querySelector('#pricing-packs').hidden = mode !== 'payg';
    document.querySelector('#pricing-plans').hidden = mode !== 'monthly';
    document.querySelector('#ru-monthly-note').hidden = mode !== 'monthly';
    document.querySelector('#pricing-badge').textContent = mode === 'payg' ? 'Pay as you go · no subscription' : 'Monthly · cancel any time';
    document.querySelector('#pricing-lead').textContent = mode === 'payg'
      ? 'No monthly fees. Buy credits that never expire and use them whenever you want, on every channel.'
      : 'Busy every month? Save on every AI reply, comment automation and phone call – up to 33% on replies and 70% on comments.';
    const ruButton = document.querySelector('button[data-payment="ru"]');
    ruButton.disabled = mode === 'monthly'; ruButton.title = mode === 'monthly' ? 'Monthly plans are paid with an international card' : '';
    document.querySelector('#pricing-shared').textContent = payment === 'ru' ? 'Credits are shared with Hansora Creative – one balance for your whole Hansora account. Prices in Russian rubles.' : 'Credits are shared with Hansora Creative – one balance for your whole Hansora account. Prices in USD.';
    document.querySelectorAll('[data-mode]').forEach(button => { const on = button.dataset.mode === mode; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('button[data-payment]').forEach(button => { const on = button.dataset.payment === payment; button.classList.toggle('active', on); button.setAttribute('aria-pressed', String(on)); });
    renderPacks(); renderPlans(); renderCurrent();
  }

  function activePlan() {
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.current_period_end && Date.parse(subscription.current_period_end) < Date.now() - 86_400_000) return null;
    return subscription;
  }

  document.querySelector('.ui-pricing-switches').addEventListener('click', event => {
    const button = event.target.closest('button[data-mode],button[data-payment]'); if (!button) return;
    if (button.disabled) return;
    if (button.dataset.mode) { mode = button.dataset.mode; if (mode === 'monthly') payment = 'international'; } else payment = button.dataset.payment;
    try { localStorage.setItem('hansora.automation.pricing.v1', JSON.stringify({ mode, payment })); } catch (_) {}
    render();
  });
  packsGrid.addEventListener('click', event => { const button = event.target.closest('[data-pack]'); const pack = PACKS.find(item => item.id === button?.dataset.pack); if (pack) openPackCheckout(pack, button); });
  plansGrid.addEventListener('click', event => { const button = event.target.closest('[data-plan]'); const plan = PLANS.find(item => item.id === button?.dataset.plan); if (plan) openPlanCheckout(plan, button); });
  document.querySelector('#current-plan').addEventListener('click', event => { if (event.target.closest('#cancel-plan')) document.querySelector('#cancel-dialog').showModal(); });
  document.querySelector('#confirm-cancel').addEventListener('click', cancelPlan);
  window.addEventListener('pageshow', () => document.querySelectorAll('.ui-pack-buy[aria-busy="true"]').forEach(resetButton));

  function resetButton(button) { button.removeAttribute('aria-busy'); button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; }
  function busy(button) { button.dataset.label = button.textContent; button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = 'Opening checkout…'; }

  // Log in first (Google, Telegram or email) and come back to this page.
  async function signedInUser() {
    const user = await api.getUser().catch(() => null);
    if (user?.id) return user;
    try { localStorage.setItem('hansora.automation.auth_return.v1', JSON.stringify({ path: '/automation-pricing.html', createdAt: Date.now() })); } catch (_) {}
    if (window.HansoraHeader?.openAuth) window.HansoraHeader.openAuth('signup');
    else location.assign('/automation.html?login=signup&returnTo=%2Fautomation-pricing.html');
    return null;
  }

  async function openPackCheckout(pack, button) {
    if (button.getAttribute('aria-busy') === 'true') return;
    if (payment === 'international' && !pack.product) return ui?.toast('This pack opens very soon. Please choose another one for now.', 'info');
    if (api?.isLocalPreview) return ui?.toast(`Preview: would open ${payment === 'ru' ? 'YooMoney (Russian card)' : 'Dodo (international card)'} for ${pack.name}.`, 'info');
    const user = await signedInUser(); if (!user) return;
    busy(button);
    try {
      const stored = pack.credits + pack.bonus;
      if (payment === 'ru') return location.assign(yooMoneyUrl(pack, stored, user));
      const url = await dodoUrl(pack.product, user);
      url.searchParams.set('metadata_credits', String(stored));
      location.assign(url.toString());
    } catch (error) {
      console.error('Unable to open checkout.', error); resetButton(button);
      ui?.toast('The checkout could not open. Please try again.', 'error');
    }
  }

  async function openPlanCheckout(plan, button) {
    if (button.getAttribute('aria-busy') === 'true' || button.disabled) return;
    if (payment === 'ru') { payment = 'international'; render(); return ui?.toast('Monthly plans are paid with an international card.', 'info'); }
    if (!plan.product) return ui?.toast('Monthly plans open very soon. Pay as you go works today.', 'info');
    if (api?.isLocalPreview) return ui?.toast(`Preview: would open the ${plan.name} subscription checkout.`, 'info');
    const user = await signedInUser(); if (!user) return;
    if (activePlan()) return ui?.toast('To change your plan, cancel the current one first. It stays active until the end of the month.', 'info');
    busy(button);
    try {
      const url = await dodoUrl(plan.product, user);
      url.searchParams.set('metadata_plan_id', plan.id);
      location.assign(url.toString());
    } catch (error) {
      console.error('Unable to open checkout.', error); resetButton(button);
      ui?.toast('The checkout could not open. Please try again.', 'error');
    }
  }

  async function dodoUrl(product, user) {
    const url = new URL(product);
    url.searchParams.set('quantity', '1');
    url.searchParams.set('redirect_url', 'https://hansora.co/automation-profile.html?checkout=success');
    Object.entries(await checkoutDefaults(user)).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('minimalAddress', 'true');
    url.searchParams.set('metadata_uid', user.id);
    const email = checkoutEmail(user);
    if (email) { url.searchParams.set('email', email); url.searchParams.set('metadata_email', email); }
    url.searchParams.set('metadata_source', 'automation');
    return url;
  }

  // YooMoney: the label tells the webhook who paid, how many credits, and that it came from Automation (max 64 chars).
  function yooMoneyUrl(pack, stored, user) {
    const url = new URL('https://yoomoney.ru/quickpay/confirm.xml');
    url.searchParams.set('receiver', YOOMONEY_RECEIVER);
    url.searchParams.set('quickpay-form', 'donate');
    url.searchParams.set('paymentType', 'AC');
    url.searchParams.set('sum', pack.rub.toFixed(2));
    url.searchParams.set('targets', `HANSORA Automation ${fmt.format(stored * DISPLAY)}⚡`);
    url.searchParams.set('successURL', RU_SUCCESS_URL);
    url.searchParams.set('label', `hansora_auto|${stored}|${user.id}|${checkoutEmail(user).replace(/\|/g, '')}`.slice(0, 64));
    return url.toString();
  }

  async function cancelPlan() {
    const button = document.querySelector('#confirm-cancel'); button.disabled = true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-subscription-cancel', { method: 'POST', body: JSON.stringify({ reason: document.querySelector('#cancel-reason').value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'cancel_failed');
      subscription = { ...subscription, ...result.subscription, cancel_at_period_end: true };
      document.querySelector('#cancel-dialog').close(); render();
      ui?.toast('Your plan is cancelled. It stays active until the end of this month.', 'success');
    } catch (error) {
      ui?.toast('The plan could not be cancelled. Please try again or contact us.', 'error');
    } finally { button.disabled = false; }
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

  async function loadSubscription() {
    if (api?.isLocalPreview) return;
    try {
      const user = await api.getUser().catch(() => null); if (!user?.id) return;
      const result = await api.db.from('automation_subscriptions').select('plan_id,status,current_period_end,cancel_at_period_end').eq('user_id', user.id).maybeSingle();
      if (!result.error && result.data) { subscription = result.data; if (activePlan()) { mode = 'monthly'; payment = 'international'; } render(); }
    } catch (_) {}
  }

  try { const saved = JSON.parse(localStorage.getItem('hansora.automation.pricing.v1') || 'null'); if (saved?.mode === 'monthly') mode = 'monthly'; if (saved?.payment === 'ru' && mode !== 'monthly') payment = 'ru'; } catch (_) {}
  if (new URLSearchParams(location.search).get('plan') === 'monthly') { mode = 'monthly'; payment = 'international'; }
  renderRates(); render(); loadSubscription();
})();
