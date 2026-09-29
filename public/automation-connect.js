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
    }
  };
  const config = configurations[channel];
  if (!config) return fail('Choose Instagram or WhatsApp from the AI employee workspace.');

  let currentStep = 0;
  let highestUnlocked = 0;
  let providerConnected = false;
  let selectedAccount = '';
  let connectedAccount = null;
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
  showStep(0);

  nextButton.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    highestUnlocked = Math.max(highestUnlocked, currentStep + 1);
    if (currentStep === 2) renderReview();
    showStep(Math.min(3, currentStep + 1));
  });
  previousButton.addEventListener('click', () => showStep(Math.max(0, currentStep - 1)));
  finishButton.addEventListener('click', saveDraft);
  progress.forEach((button, index) => button.addEventListener('click', () => { if (index <= highestUnlocked) showStep(index); }));
  document.querySelector('#provider-connect').addEventListener('click', async () => {
    if (!api.isLocalPreview) {
      if (channel === 'whatsapp') return beginWhatsAppSignup();
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
    const draft = {channel,selected_account:selectedAccount,provider_connected:providerConnected,automatic_replies:checked('#automatic-replies'),reply_delay:Number(document.querySelector('#reply-delay').value),status:providerConnected?'connected':'draft'};
    if (!api.isLocalPreview) {
      const channelTypes = channel === 'instagram' ? ['instagram_dm','instagram_comments'] : ['whatsapp'];
      const result = await api.db.from('automation_channel_connections').update({settings:draft}).eq('business_id',businessId).in('channel_type',channelTypes);
      if (result.error) return showError(api.displayError(result.error));
      const activeType = channel === 'instagram' ? 'instagram_dm' : 'whatsapp';
      const activation = await api.db.from('automation_channel_connections').update({status:'connected',connected_at:new Date().toISOString()}).eq('business_id',businessId).eq('channel_type',activeType);
      if (activation.error) return showError(api.displayError(activation.error));
    }
    try { localStorage.setItem(`hansora_${channel}_connection_preview`, JSON.stringify(draft)); } catch (_) {}
    document.querySelector('#connect-save-state').textContent = 'Live';
    setConnected(true);
    finishButton.textContent = 'Live ✓'; finishButton.disabled = true;
    ui.toast(`${config.title.replace('Connect ', '')} is live. Your AI employee is answering.`);
  }

  async function loadDraft() {
    if (!api.isLocalPreview) {
      const type = channel === 'instagram' ? 'instagram_dm' : 'whatsapp';
      const result = await api.db.from('automation_channel_connections').select('status,connected_account_label,settings').eq('business_id',businessId).eq('channel_type',type).maybeSingle();
      if (result.error) return showError(api.displayError(result.error));
      if (['connecting','connected'].includes(result.data?.status)) {
        providerConnected = true; selectedAccount = result.data.connected_account_label || selectedAccount;
        if(result.data.connected_account_label){connectedAccount={name:String(result.data.connected_account_label).split(' · ')[0]||config.title.replace('Connect ',''),detail:result.data.connected_account_label,mark:channel==='whatsapp'?'WA':'IG'};renderAccounts();selectedAccount=result.data.connected_account_label;}
        markAuthorized();
        if (result.data.status === 'connected') setConnected(true);
      }
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
    const badge = document.querySelector('#connection-state');
    badge.textContent = live ? 'Live' : 'Authorized';
    badge.classList.toggle('green', live); badge.classList.toggle('live', live); badge.classList.toggle('amber', !live);
  }
  function markAuthorized() {
    const button = document.querySelector('#provider-connect');
    button.classList.add('connected');
    document.querySelector('#provider-button-label').textContent = `${config.title.replace('Connect ', '')} connected`;
    document.querySelector('#provider-button-help').textContent = 'Continue to choose the account';
    if (!document.querySelector('#connection-state').classList.contains('green')) setConnected(false);
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
    if (!api.isLocalPreview) {
      try {
        const response = await api.authenticatedFetch('/.netlify/functions/automation-channel-disconnect', {method:'POST', body:JSON.stringify({business_id:businessId, channel})});
        if (!response.ok) throw new Error('disconnect_failed');
      } catch (_) { return showError(`${name} could not be disconnected. Please try again.`); }
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

  async function beginWhatsAppSignup(){
    const button=document.querySelector('#provider-connect');button.disabled=true;document.querySelector('#connect-save-state').textContent='Preparing WhatsApp Embedded Signup…';errorBox.hidden=true;
    try{
      const response=await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-start',{method:'POST',body:JSON.stringify({business_id:businessId})});
      const settings=await response.json().catch(()=>({}));if(!response.ok)throw new Error(settings.error||'whatsapp_connection_unavailable');
      await loadFacebookSdk(settings.app_id,settings.graph_version);
      const session={code:'',wabaId:'',phoneNumberId:'',submitted:false};
      const complete=async()=>{
        if(session.submitted||!session.code||!session.wabaId||!session.phoneNumberId)return;session.submitted=true;
        document.querySelector('#connect-save-state').textContent='Securing the selected WhatsApp number…';
        const connect=await api.authenticatedFetch('/.netlify/functions/automation-whatsapp-connect',{method:'POST',body:JSON.stringify({business_id:businessId,code:session.code,waba_id:session.wabaId,phone_number_id:session.phoneNumberId})});
        const result=await connect.json().catch(()=>({}));window.removeEventListener('message',listener);
        if(connect.status===409&&result.error==='whatsapp_pin_required')return askForPin(session.phoneNumberId);
        if(!connect.ok)throw new Error(result.error||'whatsapp_connection_failed');
        whatsAppConnected(result,session.phoneNumberId);
      };
      const listener=event=>{
        let origin;try{origin=new URL(event.origin)}catch(_){return}if(!(origin.hostname==='facebook.com'||origin.hostname.endsWith('.facebook.com')))return;
        let data=event.data;try{if(typeof data==='string')data=JSON.parse(data)}catch(_){return}
        if(data?.type!=='WA_EMBEDDED_SIGNUP')return;if(data.event==='FINISH'){session.wabaId=String(data.data?.waba_id||'');session.phoneNumberId=String(data.data?.phone_number_id||'');complete().catch(handleSignupError);}if(['CANCEL','ERROR'].includes(data.event)){window.removeEventListener('message',listener);button.disabled=false;showError(data.event==='CANCEL'?'WhatsApp authorization was cancelled.':'WhatsApp authorization could not be completed.');}
      };
      window.addEventListener('message',listener);
      window.FB.login(login=>{if(login?.authResponse?.code){session.code=String(login.authResponse.code);complete().catch(handleSignupError)}else{window.removeEventListener('message',listener);button.disabled=false;showError('WhatsApp authorization was not completed.')}},{config_id:settings.configuration_id,response_type:'code',override_default_response_type:true,extras:{setup:{}}});
      function handleSignupError(error){window.removeEventListener('message',listener);button.disabled=false;session.submitted=false;showError(api.displayError(error));}
    }catch(error){button.disabled=false;showError(api.displayError(error));}
  }

  // Testing path: connect Meta's test number (or a System User token) without the Embedded Signup popup.
  if (channel === 'whatsapp') {
    document.querySelector('#whatsapp-token').hidden = false;
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
