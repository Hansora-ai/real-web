(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const loading = document.querySelector('#connect-loading');
  const errorBox = document.querySelector('#connect-error');
  const workflow = document.querySelector('#connect-workflow');
  const channel = new URLSearchParams(location.search).get('channel');
  const params = new URLSearchParams(location.search);
  const businessId = params.get('business') || (api.isLocalPreview ? 'preview' : '');
  const user = await api.requireUser(location.pathname + location.search);
  if (!user) return;
  const ui = window.HansoraUI;

  const configurations = {
    instagram: {
      kicker:'INSTAGRAM CONNECTION', title:'Connect Instagram',
      subtitle:'Connect one professional account for DMs and comment automations.',
      requirementsTitle:'Prepare your Instagram business account',
      requirementsDescription:'The account must be an Instagram professional account you are authorized to manage.',
      requirements:['A Business or Creator Instagram account','You can manage that account'],
      authorizeTitle:'Connect your Instagram account', authorizeDescription:'Sign in with Meta and choose the Instagram account your AI employee should answer for.',
      providerMark:'instagram', providerLabel:'Continue with Instagram', providerHelp:'Opens the official Meta window', logo:'instagram',
      permissions:['Read and reply to Instagram messages','Read comments and publish replies','Read basic account and post information'],
      accounts:[{name:'Luma Studio',detail:'@luma.studio · Instagram Business',mark:'AS'},{name:'Luma Kitchens',detail:'@luma.kitchens · Instagram Business',mark:'AK'}],
      primaryLabel:'Answer Instagram DMs', primaryHelp:'Use the shared AI employee for new private messages'
    },
    whatsapp: {
      kicker:'WHATSAPP CONNECTION', title:'Connect WhatsApp',
      subtitle:'Connect a WhatsApp Business number to the same AI employee.',
      requirementsTitle:'Prepare your WhatsApp Business account',
      requirementsDescription:'Use a business number you are authorized to manage.',
      requirements:['A business phone number','Access to your Meta business account'],
      authorizeTitle:'Connect your WhatsApp Business number', authorizeDescription:'Sign in with Meta and pick the number your AI employee should answer on.',
      providerMark:'whatsapp', providerLabel:'Continue with WhatsApp', providerHelp:'Opens the official Meta window', logo:'whatsapp',
      permissions:['Receive new WhatsApp messages','Send replies from the selected number','Read the business profile and number status'],
      accounts:[{name:'Luma Studio',detail:'+1 555 010 0000 · WhatsApp Business',mark:'WA'},{name:'Luma Support',detail:'+1 555 010 0001 · WhatsApp Business',mark:'WS'}],
      primaryLabel:'Answer WhatsApp messages', primaryHelp:'Use the shared AI employee for new customer chats'
    },
    telegram: {
      kicker:'TELEGRAM CONNECTION', title:'Connect Telegram',
      subtitle:'Your AI employee answers customers who write to your own Telegram account – as you, with your name and photo.',
      requirementsTitle:'Prepare Telegram Business', requirementsDescription:'Telegram Business (part of Telegram Premium) lets a chatbot answer chats for you.',
      requirements:['Telegram Premium on your account (Telegram Business)','The Telegram app on your phone or computer'],
      authorizeTitle:'Connect your Telegram account', authorizeDescription:'Open Hansora\'s bot, press Start, then add it in Telegram Business → Chatbots. No password or token needed.',
      providerMark:'telegram', providerLabel:'Continue with Telegram', providerHelp:'Opens Telegram', logo:'telegram',
      permissions:['Read the chats you allow in Telegram Business','Reply in those chats as you','You choose which chats it can answer'],
      accounts:[{name:'Luma Studio',detail:'@luma_studio · Telegram',mark:'TG'}],
      primaryLabel:'Answer Telegram messages', primaryHelp:'Use the shared AI employee for chats you allowed'
    },
    messenger: {
      kicker:'MESSENGER CONNECTION', title:'Connect Messenger',
      subtitle:'Answer Facebook Messenger chats of your Facebook Page with the same AI employee.',
      requirementsTitle:'Prepare your Facebook Page', requirementsDescription:'You need to manage the Page on Facebook.',
      requirements:['A Facebook Page for your business','You are an admin of that Page'],
      authorizeTitle:'Connect your Facebook Page', authorizeDescription:'Sign in with Facebook and choose the Page your AI employee should answer for.',
      providerMark:'messenger', providerLabel:'Continue with Facebook', providerHelp:'Opens the official Meta window', logo:'messenger',
      permissions:['Receive messages sent to your Page','Reply from your Page','Read the Page name and picture'],
      accounts:[{name:'Luma Studio',detail:'Facebook Page',mark:'FB'}],
      primaryLabel:'Answer Messenger chats', primaryHelp:'Use the shared AI employee for new Messenger chats'
    }
  };
  const config = configurations[channel];
  if (!config) return fail('Choose a channel from the AI employee workspace.');
  const CHANNEL_TYPE = { instagram: 'instagram_dm', whatsapp: 'whatsapp', telegram: 'telegram', messenger: 'messenger' }[channel];
  const ACCOUNT_MARK = { instagram: 'IG', whatsapp: 'WA', telegram: 'TG', messenger: 'FB' }[channel];

  let currentStep = 0;
  let highestUnlocked = 0;
  let providerConnected = false;
  let selectedAccount = '';
  let connectedAccount = null;
  let isLive = false;
  let editing = false;
  const steps = [...document.querySelectorAll('[data-connect-step]')];
  const progress = [...document.querySelectorAll('[data-connect-progress]')];
  const previousButton = document.querySelector('#connect-previous');
  const nextButton = document.querySelector('#connect-next');
  const finishButton = document.querySelector('#connect-finish');
  if (!api.isLocalPreview && !/^[0-9a-f-]{36}$/i.test(businessId)) return fail('This business connection link is invalid.');
  const previewQuery = api.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : '';
  document.querySelector('#connect-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${previewQuery}`;
  document.title = `${config.title} — Hansora Automation`;
  fillCopy();
  renderAccounts();
  await loadDraft();
  if (params.get('authorized') === '1' && channel === 'instagram') {
    providerConnected = true;
    if (params.get('account')) { connectedAccount = {name:params.get('account'), detail:`${params.get('account')} · Instagram`, mark:'IG'}; renderAccounts(); }
    markAuthorized();
    highestUnlocked = 3;
    document.querySelector('#connect-save-state').textContent = 'Meta account authorized · review settings to activate';
  }
  loading.hidden = true;
  workflow.hidden = false;
  if (isLive) { highestUnlocked = 3; renderReview(); showStep(3); } else showStep(0);

  nextButton.addEventListener('click', () => {
    // Before anything is connected, this button starts the connection (same as the provider card).
    if (currentStep === 0 && !providerConnected) return document.querySelector('#provider-connect').click();
    if (!validateStep(currentStep)) return;
    highestUnlocked = Math.max(highestUnlocked, currentStep + 1);
    if (currentStep === 2) renderReview();
    showStep(Math.min(3, currentStep + 1));
  });
  previousButton.addEventListener('click', () => showStep(Math.max(0, currentStep - 1)));
  finishButton.addEventListener('click', () => {
    // A live channel opens on its summary: "Edit" walks through the settings, the last page saves them.
    if (isLive && !editing) { editing = true; return showStep(1); }
    saveDraft();
  });
  progress.forEach((button, index) => button.addEventListener('click', () => { if (index <= highestUnlocked) showStep(index); }));
  document.querySelector('#provider-connect').addEventListener('click', async () => {
    if (!api.isLocalPreview) {
      if (channel === 'whatsapp') return beginWhatsAppSignup();
      if (channel === 'telegram') return beginTelegramConnect();
      if (channel === 'messenger') return beginMessengerConnect();
      const button = document.querySelector('#provider-connect'); button.disabled = true;
      document.querySelector('#connect-save-state').textContent = 'Preparing secure Meta authorization…';
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-meta-start',{method:'POST',body:JSON.stringify({business_id:businessId})});
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.authorization_url) throw new Error(result.error || 'meta_connection_unavailable');
        location.assign(result.authorization_url);
      } catch (error) { button.disabled = false; showError(api.displayError(error)); }
      return;
    }
    providerConnected = true;
    markAuthorized();
    document.querySelector('#connect-save-state').textContent = 'Connected (preview)';
    errorBox.hidden = true;
  });
  document.querySelector('#account-options').addEventListener('change', event => {
    if (event.target.name !== 'connected_account') return;
    selectedAccount = event.target.value;
    document.querySelector('#connect-save-state').textContent = 'Account selected';
  });
  document.querySelectorAll('.connection-settings input, #reply-delay').forEach(input => input.addEventListener('change', () => {
    document.querySelector('#connect-save-state').textContent = 'Settings changed';
  }));

  function fillCopy() {
    document.querySelector('#connect-logo').className = `ui-connect-logo ${config.logo}`;
    document.querySelector('#connect-logo').innerHTML = ui.icon(config.logo);
    document.querySelector('#connect-title').textContent = config.title;
    document.querySelector('#connect-subtitle').textContent = config.subtitle;
    document.querySelector('#requirements-list').innerHTML = `<span>You need</span>${config.requirements.map(item => `<div>${ui.icon('check')}${escapeHtml(item)}</div>`).join('')}`;
    document.querySelector('#authorize-title').textContent = config.authorizeTitle;
    document.querySelector('#authorize-description').textContent = config.authorizeDescription;
    document.querySelector('#provider-mark').innerHTML = ui.icon(config.providerMark);
    document.querySelector('#provider-mark').className = `ui-provider-mark ${config.logo}`;
    document.querySelector('#provider-button-label').textContent = config.providerLabel;
    document.querySelector('#provider-button-help').textContent = config.providerHelp;
    document.querySelector('#permission-list').innerHTML = `<li class="ui-permissions-title">Hansora will be able to</li>${config.permissions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}`;
    document.querySelector('#primary-reply-label').textContent = config.primaryLabel;
    document.querySelector('#primary-reply-help').textContent = config.primaryHelp;
  }

  function renderAccounts() {
    const accounts=connectedAccount?[connectedAccount]:config.accounts;
    document.querySelector('#account-options').innerHTML = accounts.map((account,index) => `<label class="ui-option"><input type="radio" name="connected_account" value="${escapeHtml(account.detail)}"${index === 0 ? ' checked' : ''}><span class="ui-option-mark">${escapeHtml(account.mark)}</span><span class="ui-option-text"><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.detail)}</small></span><span class="ui-option-radio" aria-hidden="true"></span></label>`).join('');
    selectedAccount = accounts[0]?.detail||'';
  }

  function showStep(index) {
    currentStep = index;
    steps.forEach((step,stepIndex) => step.hidden = stepIndex !== index);
    progress.forEach((button,stepIndex) => {
      button.classList.toggle('active', stepIndex === index);
      button.classList.toggle('done', stepIndex < index);
      button.classList.toggle('reachable', stepIndex !== index && stepIndex <= highestUnlocked);
    });
    document.querySelector('.ui-stepper').style.setProperty('--progress-num', String(index / 3));
    previousButton.hidden = index === 0;
    nextButton.hidden = index === 3;
    finishButton.hidden = index !== 3;
    if (isLive && index < 3) editing = true;
    updateFooter();
  }

  function updateFooter() {
    nextButton.textContent = currentStep === 0 && !providerConnected ? 'Connect' : 'Continue';
    finishButton.disabled = false;
    finishButton.textContent = !isLive ? 'Go live' : editing ? 'Save changes' : 'Edit';
    document.querySelector('#review-title').textContent = isLive && !editing ? 'Live now' : isLive ? 'Save your changes' : 'Ready to go live';
    document.querySelector('#review-help').textContent = isLive && !editing ? 'Your AI employee is answering here. Choose Edit to change the settings.' : isLive ? 'Your AI employee keeps answering with the new settings.' : 'Customers get AI replies as soon as you turn this on.';
  }

  function validateStep(index) {
    if (index === 0 && !providerConnected) return showError(`Connect ${config.title.replace('Connect ', '')} first.`);
    if (index === 1 && !selectedAccount) return showError('Choose an account to continue.');
    errorBox.hidden = true;
    return true;
  }

  function renderReview() {
    const delay = document.querySelector('#reply-delay').selectedOptions[0].textContent;
    const items = [
      ['Channel', config.title.replace('Connect ', '')], ['Account', selectedAccount],
      ['AI replies', yesNo('#automatic-replies')], ['Reply speed', delay]
    ];
    document.querySelector('#connection-review').innerHTML = items.map(([label,value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }

  async function saveDraft() {
    ui.busy(isLive ? 'Saving your changes…' : 'Going live…');
    try { await saveDraftNow(); } finally { ui.busy(false); }
  }
  async function saveDraftNow() {
    const draft = {channel,selected_account:selectedAccount,provider_connected:providerConnected,automatic_replies:checked('#automatic-replies'),reply_delay:Number(document.querySelector('#reply-delay').value),status:providerConnected?'connected':'draft'};
    if (!api.isLocalPreview) {
      const channelTypes = channel === 'instagram' ? ['instagram_dm','instagram_comments'] : [CHANNEL_TYPE];
      const result = await api.db.from('automation_channel_connections').update({settings:draft}).eq('business_id',businessId).in('channel_type',channelTypes);
      if (result.error) return showError(api.displayError(result.error));
      const activeType = CHANNEL_TYPE;
      const activation = await api.db.from('automation_channel_connections').update({status:'connected',connected_at:new Date().toISOString()}).eq('business_id',businessId).eq('channel_type',activeType);
      if (activation.error) return showError(api.displayError(activation.error));
    }
    try { localStorage.setItem(`hansora_${channel}_connection_preview`, JSON.stringify(draft)); } catch (_) {}
    const wasLive = isLive;
    document.querySelector('#connect-save-state').textContent = 'Live';
    setConnected(true);
    editing = false; renderReview(); updateFooter();
    ui.toast(wasLive ? 'Changes saved.' : `${config.title.replace('Connect ', '')} is live. Your AI employee is answering.`);
  }

  async function loadDraft() {
    if (!api.isLocalPreview) {
      const type = CHANNEL_TYPE;
      const result = await api.db.from('automation_channel_connections').select('status,connected_account_label,settings').eq('business_id',businessId).eq('channel_type',type).maybeSingle();
      if (result.error) return showError(api.displayError(result.error));
      if (['connecting','connected'].includes(result.data?.status)) {
        providerConnected = true; selectedAccount = result.data.connected_account_label || selectedAccount;
        if(result.data.connected_account_label){connectedAccount={name:String(result.data.connected_account_label).split(' · ')[0]||config.title.replace('Connect ',''),detail:result.data.connected_account_label,mark:ACCOUNT_MARK};renderAccounts();selectedAccount=result.data.connected_account_label;}
        markAuthorized();
        if (result.data.status === 'connected') setConnected(true);
      }
      // Show the saved choices, so re-saving never resets them to the defaults.
      const saved = result.data?.settings || {};
      const replies = document.querySelector('#automatic-replies');
      if (replies && saved.automatic_replies !== undefined) replies.checked = saved.automatic_replies !== false;
      const delay = document.querySelector('#reply-delay');
      if (saved.reply_delay !== undefined && [...delay.options].some(option => option.value === String(saved.reply_delay))) delay.value = String(saved.reply_delay);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`hansora_${channel}_connection_preview`) || 'null');
      if (!saved) return;
      providerConnected = Boolean(saved.provider_connected);
      selectedAccount = saved.selected_account || selectedAccount;
      const account = [...document.querySelectorAll('input[name="connected_account"]')].find(input => input.value === selectedAccount);
      if (account) account.checked = true;
      ['automatic_replies'].forEach(key => {
        const input = document.querySelector(`#${key.replaceAll('_','-')}`); if (input) input.checked = saved[key] !== false;
      });
      if (saved.reply_delay !== undefined) document.querySelector('#reply-delay').value = String(saved.reply_delay);
      if (providerConnected) { markAuthorized(); setConnected(true); }
      document.querySelector('#connect-save-state').textContent = 'Saved draft loaded';
    } catch (_) {}
  }

  function setConnected(live) {
    document.querySelector('#channel-disconnect').hidden = false;
    if (channel === 'instagram') document.querySelector('#channel-diagnose').hidden = false;
    isLive = live;
    const badge = document.querySelector('#connection-state');
    badge.textContent = live ? 'Live' : 'Authorized';
    badge.classList.toggle('green', live); badge.classList.toggle('live', live); badge.classList.toggle('amber', !live);
  }
  function markAuthorized() {
    const button = document.querySelector('#provider-connect');
    button.classList.add('connected');
    document.querySelector('.ui-wa-mode')?.setAttribute('hidden', '');
    document.querySelector('#provider-button-label').textContent = `${config.title.replace('Connect ', '')} connected`;
    document.querySelector('#provider-button-help').textContent = 'Continue to choose the account';
    if (!document.querySelector('#connection-state').classList.contains('green')) setConnected(false);
    updateFooter();
  }
  // Shows what Meta itself reports for the connected account (webhook fields, latest DMs), for troubleshooting.
  document.querySelector('#channel-diagnose').addEventListener('click', async () => {
    const box = document.querySelector('#diagnose-result');
    box.hidden = false; box.textContent = 'Asking Meta…';
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-instagram-diagnose', {method:'POST', body:JSON.stringify({business_id:businessId})});
      box.textContent = JSON.stringify(await response.json().catch(() => ({ error: 'no_response' })), null, 2);
    } catch (_) { box.textContent = 'Could not reach Hansora. Please try again.'; }
  });
  document.querySelector('#channel-disconnect').addEventListener('click', async () => {
    const name = config.title.replace('Connect ', '');
    if (!confirm(`Disconnect ${name}? Your AI employee stops replying there and Hansora’s access is removed right away.`)) return;
    const disconnectButton = document.querySelector('#channel-disconnect');
    disconnectButton.disabled = true; disconnectButton.classList.add('is-busy'); disconnectButton.innerHTML = '<span class="ui-spinner" aria-hidden="true"></span>Disconnecting…';
    document.querySelector('#connect-save-state').textContent = `Disconnecting ${name}…`;
    if (!api.isLocalPreview) {
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-channel-disconnect', {method:'POST', body:JSON.stringify({business_id:businessId, channel})});
        if (!response.ok) throw new Error('disconnect_failed');
      } catch (_) {
        disconnectButton.disabled = false; disconnectButton.classList.remove('is-busy'); disconnectButton.textContent = 'Disconnect';
        return showError(`${name} could not be disconnected. Please try again.`);
      }
    }
    try { localStorage.removeItem(`hansora_${channel}_connection_preview`); } catch (_) {}
    window.HansoraUI.toast(`${name} disconnected`);
    setTimeout(() => location.reload(), 900);
  });
  function yesNo(selector) { return checked(selector) ? 'On' : 'Off'; }
  function checked(selector) { return document.querySelector(selector).checked; }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; errorBox.scrollIntoView({behavior:'smooth',block:'center'}); return false; }
  function fail(message) { loading.hidden = true; workflow.hidden = true; showError(message); }
  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }

  // Telegram: open Hansora's bot (Start links the account), add it in Telegram Business → Chatbots; this page
  // checks every few seconds and continues by itself once Telegram reports the connection.
  let telegramPoll = null;
  async function beginTelegramConnect() {
    const button = document.querySelector('#provider-connect'); button.disabled = true; errorBox.hidden = true;
    document.querySelector('#connect-save-state').textContent = 'Preparing Telegram…';
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-telegram-connect', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'start' }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || 'telegram_connection_unavailable');
      let box = document.querySelector('#telegram-steps');
      if (!box) { box = document.createElement('div'); box.id = 'telegram-steps'; box.className = 'ui-channel-steps'; button.insertAdjacentElement('afterend', box); }
      box.innerHTML = `<ol><li data-step="open"><span><strong>Open the bot and press Start</strong><small>This links your Telegram account to this AI employee.</small></span><a class="ui-btn secondary sm" href="${escapeHtml(result.link)}" target="_blank" rel="noopener">Open @${escapeHtml(result.bot_username)}</a></li><li data-step="add"><span><strong>Add the bot in Telegram Business</strong><small>Telegram → Settings → Telegram Business → Chatbots → add @${escapeHtml(result.bot_username)}, choose which chats it may answer, and allow “Reply to messages”.</small></span></li><li data-step="done"><span><strong>Come back here</strong><small>This page notices it by itself.</small></span></li></ol><p class="ui-faint" id="telegram-wait">Waiting for Telegram…</p>`;
      window.open(result.link, '_blank', 'noopener');
      document.querySelector('#connect-save-state').textContent = 'Waiting for Telegram…';
      clearInterval(telegramPoll); let tries = 0;
      telegramPoll = setInterval(async () => {
        if (++tries > 200) { clearInterval(telegramPoll); button.disabled = false; return; }
        try {
          const statusResponse = await api.authenticatedFetch('/.netlify/functions/automation-telegram-connect', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'status' }) });
          const status = await statusResponse.json().catch(() => ({}));
          if (status.linked) box.querySelector('[data-step="open"]')?.classList.add('done');
          if (status.step !== 'connected') return;
          clearInterval(telegramPoll);
          box.querySelectorAll('li').forEach(item => item.classList.add('done'));
          document.querySelector('#telegram-wait').textContent = status.error === 'telegram_reply_not_allowed' ? 'Connected – but in Telegram Business allow the bot to “Reply to messages”.' : 'Connected ✓';
          providerConnected = true; connectedAccount = { name: status.label || 'Telegram', detail: `${status.label || 'Telegram account'} · Telegram`, mark: 'TG' };
          renderAccounts(); markAuthorized(); button.disabled = false;
          document.querySelector('#connect-save-state').textContent = 'Telegram connected · review settings to go live';
        } catch (_) {}
      }, 3000);
    } catch (error) { button.disabled = false; showError(api.displayError(error)); }
  }

  // Messenger: the Facebook window shares the owner's Pages; the owner picks one (automatic when there is only one).
  async function beginMessengerConnect() {
    const button = document.querySelector('#provider-connect'); button.disabled = true; errorBox.hidden = true;
    document.querySelector('#connect-save-state').textContent = 'Preparing Facebook…';
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-messenger-connect', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'config' }) });
      const settings = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(settings.message || settings.error || 'messenger_connection_unavailable');
      await loadFacebookSdk(settings.app_id, settings.graph_version);
      window.FB.login(login => {
        if (login?.authResponse?.code) loadMessengerPages(String(login.authResponse.code)).catch(error => { button.disabled = false; showError(api.displayError(error)); });
        else { button.disabled = false; showError('Facebook authorization was not completed.'); }
      }, { config_id: settings.configuration_id, response_type: 'code', override_default_response_type: true });
    } catch (error) { button.disabled = false; showError(api.displayError(error)); }
  }
  async function loadMessengerPages(code) {
    document.querySelector('#connect-save-state').textContent = 'Reading your Pages…';
    const response = await api.authenticatedFetch('/.netlify/functions/automation-messenger-connect', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'pages', code }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'messenger_pages_failed');
    const pages = result.pages || [];
    if (pages.length === 1) return selectMessengerPage(pages[0].id);
    let box = document.querySelector('#messenger-pages');
    if (!box) { box = document.createElement('div'); box.id = 'messenger-pages'; box.className = 'ui-channel-steps'; document.querySelector('#provider-connect').insertAdjacentElement('afterend', box); }
    box.innerHTML = `<p><strong>Which Page should your AI employee answer for?</strong></p>${pages.map((page, index) => `<label class="ui-option"><input type="radio" name="messenger_page" value="${escapeHtml(page.id)}"${index === 0 ? ' checked' : ''}><span class="ui-option-main"><strong>${escapeHtml(page.name)}</strong><small>${page.can_message ? 'Facebook Page' : 'You may not have messaging rights on this Page'}</small></span></label>`).join('')}<button class="ui-btn primary sm" type="button" id="messenger-use-page">Use this Page</button>`;
    box.querySelector('#messenger-use-page').addEventListener('click', () => { const chosen = box.querySelector('input[name="messenger_page"]:checked'); if (chosen) selectMessengerPage(chosen.value).catch(error => showError(api.displayError(error))); });
    document.querySelector('#connect-save-state').textContent = 'Choose your Page';
  }
  async function selectMessengerPage(pageId) {
    document.querySelector('#connect-save-state').textContent = 'Connecting your Page…';
    const response = await api.authenticatedFetch('/.netlify/functions/automation-messenger-connect', { method: 'POST', body: JSON.stringify({ business_id: businessId, action: 'select', page_id: pageId }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'messenger_connect_failed');
    document.querySelector('#messenger-pages')?.remove();
    providerConnected = true; connectedAccount = { name: result.account.label, detail: `${result.account.label} · Facebook Page`, mark: 'FB' };
    renderAccounts(); markAuthorized(); document.querySelector('#provider-connect').disabled = false;
    document.querySelector('#connect-save-state').textContent = 'Page connected · review settings to go live';
  }

  async function beginWhatsAppSignup(){
    const button=document.querySelector('#provider-connect');button.disabled=true;document.querySelector('#connect-save-state').textContent='Preparing WhatsApp Embedded Signup…';errorBox.hidden=true;
    try{
      const response=await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-start',{method:'POST',body:JSON.stringify({business_id:businessId})});
      const settings=await response.json().catch(()=>({}));
      if(settings.error==='missing_meta_whatsapp_configuration_id'){button.disabled=false;document.querySelector('#connect-save-state').textContent='Not connected yet';document.querySelector('#whatsapp-token').hidden=false;return showError('WhatsApp sign-up through Meta is not switched on yet. For testing, use “Testing: connect with a token” below.');}
      if(!response.ok)throw new Error(settings.error||'whatsapp_connection_unavailable');
      await loadFacebookSdk(settings.app_id,settings.graph_version);
      // Coexistence keeps the number working in the WhatsApp Business app on the owner's phone.
      const coexistence=document.querySelector('input[name="wa-mode"]:checked')?.value!=='new';
      const session={code:'',wabaId:'',phoneNumberId:'',finished:false,submitted:false};
      const complete=async()=>{
        if(session.submitted||!session.code||!session.wabaId||!(session.phoneNumberId||(coexistence&&session.finished)))return;session.submitted=true;
        document.querySelector('#connect-save-state').textContent='Securing the selected WhatsApp number…';
        const connect=await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-connect',{method:'POST',body:JSON.stringify({business_id:businessId,code:session.code,waba_id:session.wabaId,phone_number_id:session.phoneNumberId||undefined,coexistence})});
        const result=await connect.json().catch(()=>({}));window.removeEventListener('message',listener);
        if(connect.status===409&&result.error==='whatsapp_pin_required')return askForPin(session.phoneNumberId);
        if(!connect.ok)throw new Error(result.error||'whatsapp_connection_failed');
        whatsAppConnected(result,result.account?.phone_number_id||session.phoneNumberId);
      };
      const listener=event=>{
        let origin;try{origin=new URL(event.origin)}catch(_){return}if(!(origin.hostname==='facebook.com'||origin.hostname.endsWith('.facebook.com')))return;
        let data=event.data;try{if(typeof data==='string')data=JSON.parse(data)}catch(_){return}
        if(data?.type!=='WA_EMBEDDED_SIGNUP')return;if(['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING','FINISH_ONLY_WABA'].includes(data.event)){session.finished=true;session.wabaId=String(data.data?.waba_id||'');session.phoneNumberId=String(data.data?.phone_number_id||'');complete().catch(handleSignupError);}if(['CANCEL','ERROR'].includes(data.event)){window.removeEventListener('message',listener);button.disabled=false;showError(data.event==='CANCEL'?'WhatsApp authorization was cancelled.':'WhatsApp authorization could not be completed.');}
      };
      window.addEventListener('message',listener);
      window.FB.login(login=>{if(login?.authResponse?.code){session.code=String(login.authResponse.code);complete().catch(handleSignupError)}else{window.removeEventListener('message',listener);button.disabled=false;showError('WhatsApp authorization was not completed.')}},{config_id:settings.configuration_id,response_type:'code',override_default_response_type:true,extras:coexistence?{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'}:{setup:{}}});
      function handleSignupError(error){window.removeEventListener('message',listener);button.disabled=false;session.submitted=false;showError(api.displayError(error));}
    }catch(error){button.disabled=false;showError(api.displayError(error));}
  }

  // Testing path: connect Meta's test number (or a System User token) without the Embedded Signup popup.
  if (channel === 'whatsapp') {
    // Most businesses already answer customers in the WhatsApp Business app: by default the number stays there too.
    document.querySelector('#provider-connect')?.insertAdjacentHTML('beforebegin', `<fieldset class="ui-wa-mode"><legend>Which number?</legend>
      <label><input type="radio" name="wa-mode" value="app" checked><span><strong>My WhatsApp Business app number</strong><small>Recommended. Keep using WhatsApp Business on your phone – you can still text customers yourself any time. Your AI employee answers too, and steps back in a chat when you write from the phone.</small></span></label>
      <label><input type="radio" name="wa-mode" value="new"><span><strong>A new number just for Hansora</strong><small>A number not used in any WhatsApp app. You reply to customers from the Hansora inbox.</small></span></label></fieldset>`);
    // The token option is only for testing: it is shown while Meta's WhatsApp sign-up (Embedded Signup) is not
    // configured yet, and disappears for everyone once it is.
    if (api.isLocalPreview) document.querySelector('#whatsapp-token').hidden = false;
    else api.authenticatedFetch('/.netlify/functions/automation-whatsapp-start', {method:'POST', body:JSON.stringify({business_id:businessId})})
      .then(response => response.json().then(result => ({ ok: response.ok, result })).catch(() => ({ ok: response.ok, result: {} })))
      .then(({ ok, result }) => { document.querySelector('#whatsapp-token').hidden = ok || result.error !== 'missing_meta_whatsapp_configuration_id'; })
      .catch(() => {});
    document.querySelector('#whatsapp-token-form').addEventListener('submit', async event => {
      event.preventDefault(); errorBox.hidden = true;
      const phoneNumberId = document.querySelector('#wa-token-phone').value.trim(), wabaId = document.querySelector('#wa-token-waba').value.trim(), accessToken = document.querySelector('#wa-token-value').value.trim();
      const submit = event.target.querySelector('button'); submit.disabled = true; document.querySelector('#connect-save-state').textContent = 'Checking the number with Meta…';
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-connect', {method:'POST', body:JSON.stringify({business_id:businessId, phone_number_id:phoneNumberId, waba_id:wabaId, access_token:accessToken})});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'whatsapp_connection_failed');
        document.querySelector('#wa-token-value').value = '';
        document.querySelector('#whatsapp-token').open = false;
        whatsAppConnected(result, phoneNumberId);
      } catch (error) { showError(api.displayError(error)); }
      finally { submit.disabled = false; }
    });
  }

  function whatsAppConnected(result,phoneNumberId){
    const button=document.querySelector('#provider-connect');
    const label=result.account?.label||phoneNumberId;connectedAccount={name:result.account?.verified_name||'WhatsApp Business',detail:label,mark:'WA'};renderAccounts();selectedAccount=label;providerConnected=true;highestUnlocked=3;
    document.querySelector('#whatsapp-pin').hidden=true;button.disabled=false;markAuthorized();document.querySelector('#connect-save-state').textContent='WhatsApp number authorized · review settings to activate';showStep(1);
  }

  // The number already uses WhatsApp two-step verification; registration needs the owner's PIN.
  function askForPin(phoneNumberId){
    const form=document.querySelector('#whatsapp-pin'),input=document.querySelector('#whatsapp-pin-input');
    form.hidden=false;input.value='';input.focus();document.querySelector('#connect-save-state').textContent='Number authorized · PIN needed to activate';
    form.onsubmit=async event=>{
      event.preventDefault();errorBox.hidden=true;
      const pin=input.value.trim();if(!/^\d{6}$/.test(pin))return showError('Enter the 6-digit two-step verification PIN.');
      const submit=form.querySelector('button');submit.disabled=true;document.querySelector('#connect-save-state').textContent='Activating the WhatsApp number…';
      try{
        const response=await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-connect',{method:'POST',body:JSON.stringify({business_id:businessId,phone_number_id:phoneNumberId,pin})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error==='whatsapp_pin_incorrect'?'That PIN was not accepted. Check it in WhatsApp Manager and try again.':result.error||'whatsapp_connection_failed');
        whatsAppConnected(result,phoneNumberId);
      }catch(error){showError(api.displayError(error));}
      finally{submit.disabled=false;}
    };
  }

  function loadFacebookSdk(appId,version){
    if(window.FB){window.FB.init({appId,cookie:true,xfbml:false,version});return Promise.resolve()}
    return new Promise((resolve,reject)=>{window.fbAsyncInit=()=>{window.FB.init({appId,cookie:true,xfbml:false,version});resolve()};const existing=document.querySelector('#facebook-jssdk');if(existing)return;const script=document.createElement('script');script.id='facebook-jssdk';script.async=true;script.defer=true;script.crossOrigin='anonymous';script.src='https://connect.facebook.net/en_US/sdk.js';script.onerror=()=>reject(new Error('facebook_sdk_unavailable'));document.head.appendChild(script)});
  }
})();
