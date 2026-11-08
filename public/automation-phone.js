(async function () {
  'use strict';
  const api = window.HansoraAutomation;
  const ui = window.HansoraUI;
  const $ = selector => document.querySelector(selector);
  const user = await api.requireUser(location.pathname + location.search); if (!user) return;
  const params = new URLSearchParams(location.search);
  const businessId = params.get('business') || (api.isLocalPreview ? 'preview' : '');
  const previewSuffix = api.isLocalPreview && location.protocol !== 'file:' ? '&preview=1' : '';
  $('#phone-back').href = `automation-agent.html?id=${encodeURIComponent(businessId)}${previewSuffix}`;
  $('#phone-tools-link').href = `automation-tools.html?business=${encodeURIComponent(businessId)}${previewSuffix}`;
  const STORAGE = 'hansora_automation_phone_setup';
  let step = params.get('test') === '1' ? 4 : 1;
  // True after "Edit settings" on a number the business already has: the steps only change settings, nothing is bought.
  let editing = false;


  let saved = {};
  // numbers: the business's Hansora numbers (one per country). requests: the owner's contact requests per country.
  let line = { numbers:[], countries:[], requests:[], loaded:false, where:'' };
  // Every country an owner can pick. Countries where local numbers are being
  // prepared (paperwork or a local operator) are marked as coming soon.
  const ALL_COUNTRIES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'.split(' ');
  const COMING_SOON = new Set('AM RU BR CH CZ DO EE HK ID IT KR LT LV NZ PL RO SE SG SI SK TH TR ZA'.split(' '));
  // Same codes as the AI's language list (lib/automation/instructions.mjs).
  const LANGUAGES = { en:'English', hy:'Armenian', ru:'Russian', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese', uk:'Ukrainian', pl:'Polish', nl:'Dutch', tr:'Turkish', ar:'Arabic', ka:'Georgian', zh:'Chinese', ja:'Japanese', ko:'Korean', hi:'Hindi' };
  const CONTACT_METHODS = { whatsapp:['WhatsApp', '+374 91 123456'], telegram:['Telegram', '@username or +374 91 123456'] };
  // Gemini voices (same list as lib/automation/phone.mjs). The first four are the recommended ones.
  const VOICES = [['Leda','female','Youthful'],['Callirrhoe','female','Easy-going'],['Schedar','male','Even'],['Sadachbia','male','Lively'],['Zephyr','female','Bright'],['Kore','female','Firm'],['Aoede','female','Breezy'],['Autonoe','female','Bright'],['Despina','female','Smooth'],['Erinome','female','Clear'],['Laomedeia','female','Upbeat'],['Achernar','female','Soft'],['Gacrux','female','Mature'],['Pulcherrima','female','Forward'],['Vindemiatrix','female','Gentle'],['Sulafat','female','Warm'],['Puck','male','Upbeat'],['Charon','male','Informative'],['Fenrir','male','Excitable'],['Orus','male','Firm'],['Enceladus','male','Breathy'],['Iapetus','male','Clear'],['Umbriel','male','Easy-going'],['Algieba','male','Smooth'],['Algenib','male','Gravelly'],['Rasalgethi','male','Informative'],['Alnilam','male','Firm'],['Achird','male','Friendly'],['Zubenelgenubi','male','Casual'],['Sadaltager','male','Knowledgeable']].map(([name, gender, style]) => ({ name, gender, style }));
  const RECOMMENDED_VOICES = VOICES.slice(0, 4);
  const voicePlayer = { audio:null, button:null };
  // Call automations ("when … → the AI calls …"). Defaults match lib/automation/phone-auto-calls.mjs.
  const FLOWS = [
    { id:'transfer', icon:'🙋', when:'A caller wants a real person', then:'Your AI calls you, tells you who it is and connects you' },
    { id:'order', icon:'🛍️', when:'Your AI takes a new order or request', then:'Your AI calls the customer to confirm it', unit:'delay_minutes', unitLabel:'minutes after', min:1, max:1440, value:10, purpose:'Confirm the customer’s order and answer their questions.', outgoing:true },
    { id:'reminder', icon:'📅', when:'A booking is coming up', then:'Your AI calls the customer to remind them', unit:'hours_before', unitLabel:'hours before', min:1, max:72, value:24, purpose:'Remind the customer about their booking and ask them to confirm they are coming.', outgoing:true }
  ];
  let agentLanguages = ['en'];
  if (api.isLocalPreview) { try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch (_) {} agentLanguages = ['hy', 'ru', 'en']; }
  else if (/^[0-9a-f-]{36}$/i.test(businessId)) {
    const result = await api.db.from('automation_channel_connections').select('status,settings').eq('business_id', businessId).eq('channel_type', 'phone').maybeSingle();
    if (result.error) return fail(api.displayError(result.error));
    saved = result.data?.settings || {};
    // The employee's own languages are the starting choice for "Only languages I choose".
    const agentRow = await api.db.from('automation_agents').select('primary_language,supported_languages').eq('business_id', businessId).maybeSingle();
    const codes = [agentRow.data?.primary_language, ...(agentRow.data?.supported_languages || [])].filter(code => LANGUAGES[code]);
    if (codes.length) agentLanguages = [...new Set(codes)];
  } else return fail('Open phone setup from your AI employee workspace.');
  // Owners type their country; names in their own language and in English both match.
  const englishName = code => { try { return new Intl.DisplayNames(['en'], { type:'region' }).of(code) || code; } catch (_) { return code; } };
  const countryFor = text => { const value = String(text || '').trim().toLowerCase(); return value ? ALL_COUNTRIES.find(code => [countryName(code), englishName(code), code].some(item => item.toLowerCase() === value)) || '' : ''; };
  applySaved(saved);
  $('#line-where').value = line.where ? countryName(line.where) : '';
  $('#phone-loading').hidden = true; $('#phone-app').hidden = false;
  render();
  loadLine();
  loadCalls();
  preloadVoices();

  document.querySelectorAll('input[name="number-mode"]').forEach(input => input.addEventListener('change', event => { if (event.isTrusted) { line.modeTouched = true; editing = false; } syncForward(); render(); }));
  document.querySelectorAll('input[name="answer-mode"]').forEach(input => input.addEventListener('change', renderLine));
  document.querySelectorAll('input[name="language-mode"]').forEach(input => input.addEventListener('change', renderLanguages));
  for (const box of ['#line-contact', '#option-detail', '#phone-live', '#line-numbers', '#sip-import']) $(box).addEventListener('click', event => { const button = event.target.closest('[data-line-action]'); if (button) lineAction(button.dataset.lineAction, button); });
  // The contact field's hint follows the chosen method.
  document.addEventListener('change', event => { if (event.target.matches('[data-contact-method]')) event.target.closest('.contact-box').querySelector('[data-contact-value]').placeholder = CONTACT_METHODS[event.target.value][1]; });
  $('#celebrate-done').addEventListener('click', () => { $('#phone-celebrate').hidden = true; });
  $('#call-now').addEventListener('click', callNow);
  // "Test a call" (top of the page): straight to the microphone test in step 4, no number needed.
  $('#phone-try').addEventListener('click', () => { step = 4; render(); $('#test-call')?.scrollIntoView({ behavior:'smooth', block:'center' }); });
  // Comments-only accounts have no business information yet: the test would not know the business.
  if (!api.isLocalPreview) Promise.resolve(api.db.from('automation_businesses').select('setup_mode').eq('id', businessId).maybeSingle()).then(result => {
    if (result?.data?.setup_mode !== 'comments') return;
    const try_ = $('#phone-try'); const link = document.createElement('a');
    link.className = 'ui-btn primary sm'; link.href = `automation-setup.html?id=${encodeURIComponent(businessId)}`; link.textContent = 'Create my AI employee first';
    link.title = 'Your AI employee needs your business information before it can answer calls';
    try_.replaceWith(link);
  }).catch(() => {});
  $('#make-call-open').addEventListener('click', () => { $('#make-call').hidden = !$('#make-call').hidden; if (!$('#make-call').hidden) $('#call-now-number').focus(); });
  $('#auto-save').addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { if (await save({ quiet:true })) ui.toast('Call automations saved.'); } finally { button.disabled = false; } });
  // A card opens when it is switched on.
  $('#flow-cards').addEventListener('change', event => { const card = event.target.closest('.flow-card'); if (event.target.matches('[data-flow-on]') && card) { card.classList.toggle('on', event.target.checked); card.querySelector('.flow-body').hidden = !event.target.checked; } });
  // Keeps the SIP import box open or closed across re-renders (toggle does not bubble, so listen while capturing).
  $('#sip-import').addEventListener('toggle', event => { if (event.target.matches('details[data-sip]')) line.sipOpen = event.target.open; }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('#phone-celebrate').hidden = true; });
  // A full-width list under the field: matches by name (own language or English) as the owner types.
  const SORTED_COUNTRIES = ALL_COUNTRIES.slice().sort((a, b) => countryName(a).localeCompare(countryName(b)));
  let menuIndex = 0;
  function chooseCountry(code) {
    closeMenu(); $('#line-where').value = code ? countryName(code) : '';
    if (code === line.where) return;
    line.where = code; renderLine(); if (step === 4) render(); if (code) recordCountry();
  }
  function menuMatches() {
    const text = $('#line-where').value.trim().toLowerCase();
    if (!text || countryFor(text) === line.where && line.where) return SORTED_COUNTRIES;
    const starts = [], contains = [];
    for (const code of SORTED_COUNTRIES) {
      const names = [countryName(code), englishName(code)].map(item => item.toLowerCase());
      if (names.some(item => item.startsWith(text)) || code.toLowerCase() === text) starts.push(code);
      else if (names.some(item => item.includes(text))) contains.push(code);
    }
    return [...starts, ...contains];
  }
  function openMenu() {
    const matches = menuMatches(); const menu = $('#line-where-menu');
    menuIndex = Math.min(menuIndex, Math.max(matches.length - 1, 0));
    menu.innerHTML = matches.length
      ? matches.map((code, index) => `<div role="option" data-code="${code}" aria-selected="${index === menuIndex}" style="padding:10px 12px;border-radius:8px;cursor:pointer;font-size:14px;${index === menuIndex ? 'background:var(--surface-2);' : ''}">${escapeHtml(countryName(code))}</div>`).join('')
      : '<div style="padding:10px 12px;color:var(--text-3);font-size:14px">No country found</div>';
    menu.hidden = false; $('#line-where').setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block:'nearest' });
  }
  function closeMenu() { $('#line-where-menu').hidden = true; $('#line-where').setAttribute('aria-expanded', 'false'); }
  $('#line-where').addEventListener('focus', () => { menuIndex = Math.max(SORTED_COUNTRIES.indexOf(line.where), 0); openMenu(); });
  $('#line-where').addEventListener('input', () => { menuIndex = 0; openMenu(); });
  $('#line-where').addEventListener('keydown', event => {
    const matches = menuMatches();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); menuIndex = (menuIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % Math.max(matches.length, 1); openMenu(); }
    else if (event.key === 'Enter') { event.preventDefault(); if (matches[menuIndex]) chooseCountry(matches[menuIndex]); }
    else if (event.key === 'Escape') closeMenu();
  });
  // mousedown runs before the field loses focus, so the click always lands.
  $('#line-where-menu').addEventListener('mousedown', event => { const item = event.target.closest('[data-code]'); if (item) { event.preventDefault(); chooseCountry(item.dataset.code); $('#line-where').blur(); } });
  $('#line-where').addEventListener('blur', () => setTimeout(() => { closeMenu(); const code = countryFor($('#line-where').value); if (code) chooseCountry(code); else $('#line-where').value = line.where ? countryName(line.where) : ''; }, 120));
  // Saved right away, so Hansora sees which countries owners want even if they leave.
  function recordCountry() {
    if (!api.isLocalPreview && line.where) api.authenticatedFetch('/.netlify/functions/automation-phone-line', { method:'POST', body:JSON.stringify({ business_id:businessId, action:'pick', country:line.where }) }).catch(() => {});
  }
  document.querySelectorAll('.ui-stepper li').forEach(item => item.addEventListener('click', () => { const target = Number(item.dataset.step); if (target < step) { step = target; render(); } }));
  $('#phone-previous').addEventListener('click', () => { if (step > 1) { step--; render(); } });
  $('#phone-review').addEventListener('click', event => { const card = event.target.closest('[data-edit-step]'); if (!card) return; step = Number(card.dataset.editStep); render(); $('.ui-stepper').scrollIntoView({ behavior:'smooth', block:'start' }); });
  $('#phone-next').addEventListener('click', async () => {
    if (step === 1 && mode() === 'none') { showError('Choose how customers reach you.'); return; }
    if (step === 1 && mode() === 'new' && line.where && numberIn(line.where)) { showError(`You already have a ${countryName(line.where)} number. Choose another country, or press Edit settings on your number.`); return; }
    if (step === 1 && mode() === 'forward' && !/^\+?[\d\s()-]{8,20}$/.test($('#phone-number').value.trim())) { showError('Enter the business number to forward.'); return; }
    if (step === 3 && languageMode() === 'only' && !chosenLanguages().length) { showError('Choose at least one language, or pick "The caller\'s language".'); return; }
    $('#phone-error').hidden = true;
    if (step < 4) { step++; render(); return; }
    // Where a number can be had, saving also gets it, so one click makes the line live.
    if (canGetNumber()) { $('#phone-next').dataset.country = targetCountry(); await lineAction('activate', $('#phone-next')); return; }
    await save();
  });
  if (api.isLocalPreview) $('#test-call').addEventListener('click', event => previewCall(event.currentTarget));
  else window.HansoraVoiceTest.mount({
    api, businessId, getSettings:collect,
    elements:{ root:$('#phone-app'), button:$('#test-call'), orb:$('#call-orb'), status:$('#call-status'), timer:$('#call-timer'), error:$('#phone-error'), audio:$('#enable-call-audio'), transcript:$('#phone-transcript') }
  });

  function mode() { return document.querySelector('input[name="number-mode"]:checked').value; }
  // How this business is connected: the option chosen now, otherwise what it already uses.
  function currentMode() { const chosen = mode(); return chosen === 'none' ? saved.number_mode || 'new' : chosen; }
  function languageMode() { return document.querySelector('input[name="language-mode"]:checked').value; }
  function chosenLanguages() { return [...document.querySelectorAll('#language-list input:checked')].map(input => input.value); }
  function syncForward() { $('#forward-field').hidden = mode() !== 'forward'; $('#answer-mode-field').hidden = currentMode() !== 'forward'; renderLine(); }
  function collect() {
    const languages = languageMode() === 'only' ? chosenLanguages() : [];
    return { number_mode:currentMode(), forward_number:$('#phone-number').value.trim(), voice:selectedVoice(), voice_model:'gemini-3.8-live', greeting:$('#phone-greeting').value.trim(), answer_mode:currentMode() === 'forward' ? document.querySelector('input[name="answer-mode"]:checked').value : 'always', transfer_number:$('#transfer-number').value.trim(), transfer_on:flowOn('transfer'), transfer_mode:$('#transfer-warm').checked ? 'warm' : 'direct', auto_calls:readAutoCalls(), save_transcripts:$('#save-transcripts').checked, country:line.where || undefined, language_mode:languages.length ? 'only' : 'auto', languages };
  }
  function applySaved(data) {
    // "Get a new phone number" was the old default, so a saved "new" is not a real choice and stays unchosen.
    if (data.number_mode && data.number_mode !== 'new') document.querySelector(`input[name="number-mode"][value="${data.number_mode}"]`)?.click();
    if (data.forward_number) $('#phone-number').value = data.forward_number;
    if (ALL_COUNTRIES.includes(data.country)) line.where = data.country;
    renderVoices(data.voice);
    renderAutoCalls(data.auto_calls);
    if (data.greeting) $('#phone-greeting').value = data.greeting;
    if (data.answer_mode) { const input = document.querySelector(`input[name="answer-mode"][value="${data.answer_mode}"]`); if (input) input.checked = true; }
    if (data.transfer_number) $('#transfer-number').value = data.transfer_number;
    if (data.transfer_mode === 'direct') $('#transfer-warm').checked = false;
    setFlowOn('transfer', data.transfer_on !== false && Boolean(data.transfer_number));
    if (data.save_transcripts === false) $('#save-transcripts').checked = false;
    if (data.language_mode === 'only' && Array.isArray(data.languages) && data.languages.length) document.querySelector('input[name="language-mode"][value="only"]').checked = true;
    renderLanguages(Array.isArray(data.languages) && data.languages.length ? data.languages : agentLanguages);
    syncForward();
  }
  // Voice step: four recommended voices on top, the rest under "More voices"; ▶ plays a short sample.
  function renderVoices(chosen) {
    const current = VOICES.some(voice => voice.name === chosen) ? chosen : 'Leda';
    const card = voice => `<label class="ui-option"><input type="radio" name="phone-voice" value="${voice.name}"${voice.name === current ? ' checked' : ''}><span class="ui-option-text"><strong>${voice.name}</strong><small>${voice.gender === 'female' ? 'Female' : 'Male'} · ${voice.style}</small></span><button class="ui-voice-play" type="button" data-voice-play="${voice.name}" aria-label="Play ${voice.name}">▶</button><span class="ui-option-radio" aria-hidden="true"></span></label>`;
    $('#voice-recommended').innerHTML = RECOMMENDED_VOICES.map(card).join('');
    const rest = VOICES.slice(4);
    $('#voice-female').innerHTML = rest.filter(voice => voice.gender === 'female').map(card).join('');
    $('#voice-male').innerHTML = rest.filter(voice => voice.gender === 'male').map(card).join('');
    // A chosen voice from the longer list keeps that list open, so the owner sees it.
    if (!RECOMMENDED_VOICES.some(voice => voice.name === current)) $('.ui-voice-more').open = true;
    if (!renderVoices.bound) {
      renderVoices.bound = true;
      $('#voice-picker').addEventListener('click', event => {
        const button = event.target.closest('[data-voice-play]');
        if (!button) return;
        // Playing a sample does not change the chosen voice.
        event.preventDefault(); event.stopPropagation();
        playVoice(button);
      });
    }
  }
  function voiceSampleUrl(name) {
    const lang = ['hy', 'ru', 'en'].find(code => agentLanguages.includes(code)) || 'en';
    return `/.netlify/functions/automation-phone-voice-preview?voice=${encodeURIComponent(name)}&lang=${lang}&v=1`;
  }
  // The first sample of a voice takes a few seconds to make; the four recommended ones are fetched as soon as the
  // Voice step opens, so ▶ plays at once (they are cached afterwards for everyone).
  function preloadVoices() {
    if (preloadVoices.done || api.isLocalPreview || typeof fetch !== 'function') return;
    preloadVoices.done = true;
    for (const voice of RECOMMENDED_VOICES) fetch(voiceSampleUrl(voice.name)).catch(() => null);
  }
  function selectedVoice() { return document.querySelector('input[name="phone-voice"]:checked')?.value || 'Leda'; }
  function stopVoice() {
    if (voicePlayer.audio) { voicePlayer.audio.pause(); voicePlayer.audio = null; }
    if (voicePlayer.button) { voicePlayer.button.classList.remove('playing', 'loading'); voicePlayer.button.textContent = '▶'; voicePlayer.button = null; }
  }
  function playVoice(button) {
    const same = voicePlayer.button === button;
    stopVoice();
    if (same) return;
    const audio = new Audio(voiceSampleUrl(button.dataset.voicePlay));
    voicePlayer.audio = audio; voicePlayer.button = button;
    button.classList.add('loading'); button.textContent = '…';
    audio.addEventListener('playing', () => { if (voicePlayer.audio !== audio) return; button.classList.remove('loading'); button.classList.add('playing'); button.textContent = '■'; });
    audio.addEventListener('ended', () => { if (voicePlayer.audio === audio) stopVoice(); });
    audio.addEventListener('error', () => { if (voicePlayer.audio !== audio) return; stopVoice(); $('#voice-hint').textContent = 'This sample could not play right now. Please try again in a moment.'; });
    audio.play().catch(() => { if (voicePlayer.audio === audio) stopVoice(); });
  }
  // Call automations: one card per "when → then", switched on and off, opened when on.
  function renderAutoCalls(saved = {}) {
    $('#flow-cards').innerHTML = FLOWS.map(flow => {
      const value = saved?.[flow.id] || {};
      const amount = Number.isFinite(Number(value[flow.unit])) ? Number(value[flow.unit]) : flow.value;
      const body = flow.id === 'transfer'
        ? `<label class="ui-label" for="transfer-number">Your phone number</label><input class="ui-input" id="transfer-number" type="tel" placeholder="+1 555 010 0001"><div class="ui-setting" id="transfer-warm-row" style="margin-top:10px"><span><strong>Tell me about the caller first</strong><small>The AI says who is calling and what they need, then connects you. Off: the call is passed straight to you.</small></span><input class="ui-switch" id="transfer-warm" type="checkbox" checked></div><p class="ui-hint" style="margin:8px 0 0">If you don’t answer, the AI tells the caller you will call back, and sends you their message. Works on real calls, not in the browser test.</p>`
        : `<div class="flow-row"><span class="ui-hint" style="margin:0">Call</span><input class="ui-input" type="number" data-flow-amount min="${flow.min}" max="${flow.max}" value="${amount}"><span class="ui-hint" style="margin:0">${escapeHtml(flow.unitLabel)}</span></div><label class="ui-label" style="display:block;margin:12px 0 6px">What the AI says</label><textarea class="ui-textarea" rows="2" maxlength="300" data-flow-purpose>${escapeHtml(value.purpose || flow.purpose)}</textarea><p class="ui-hint flow-needs" hidden style="margin:8px 0 0">Needs a Hansora number that can make calls.</p>`;
      const on = flow.id === 'transfer' ? false : value.on === true;
      return `<div class="flow-card${on ? ' on' : ''}" data-flow="${flow.id}"><div class="flow-head"><span class="flow-icon" aria-hidden="true">${flow.icon}</span><div class="flow-text"><span class="flow-when">When</span>${escapeHtml(flow.when)}<div class="flow-then">→ ${escapeHtml(flow.then)}</div></div><input class="ui-switch" type="checkbox" data-flow-on aria-label="${escapeHtml(flow.when)}"${on ? ' checked' : ''}></div><div class="flow-body"${on ? '' : ' hidden'}>${body}</div></div>`;
    }).join('');
    $('#auto-from').value = /^\d\d:\d\d$/.test(saved?.from || '') ? saved.from : '09:00';
    $('#auto-to').value = /^\d\d:\d\d$/.test(saved?.to || '') ? saved.to : '20:00';
  }
  function flowCard(id) { return document.querySelector(`.flow-card[data-flow="${id}"]`); }
  function flowOn(id) { return Boolean(flowCard(id)?.querySelector('[data-flow-on]')?.checked); }
  function setFlowOn(id, on) { const card = flowCard(id); if (!card) return; card.querySelector('[data-flow-on]').checked = on; card.classList.toggle('on', on); card.querySelector('.flow-body').hidden = !on; }
  function readAutoCalls() {
    const result = { from:$('#auto-from').value || '09:00', to:$('#auto-to').value || '20:00' };
    for (const flow of FLOWS.filter(item => item.unit)) {
      const card = flowCard(flow.id); if (!card) continue;
      const amount = Math.min(flow.max, Math.max(flow.min, Math.round(Number(card.querySelector('[data-flow-amount]').value) || flow.value)));
      result[flow.id] = { on:flowOn(flow.id), [flow.unit]:amount, purpose:card.querySelector('[data-flow-purpose]').value.trim().slice(0, 300) || flow.purpose };
    }
    return result;
  }
  // Hidden without a phone number. Calls the customer needs a number that can call out; transfer works on any number.
  function renderOutgoing() {
    $('#phone-outgoing').hidden = !liveNumbers().length;
    const canCall = liveNumbers().some(item => item.can_call);
    $('#make-call-open').hidden = !canCall;
    if (!canCall) $('#make-call').hidden = true;
    $('#transfer-warm-row').hidden = !canCall;
    for (const flow of FLOWS.filter(item => item.outgoing)) {
      const card = flowCard(flow.id); if (!card) continue;
      card.querySelector('.flow-needs').hidden = canCall;
      card.querySelector('[data-flow-on]').disabled = !canCall;
      card.style.opacity = canCall ? '' : '.6';
    }
  }
  async function callNow() {
    const status = $('#call-now-status'), button = $('#call-now');
    const to = $('#call-now-number').value.trim(), purpose = $('#call-now-purpose').value.trim();
    if (!/^\+?[\d\s()-]{8,20}$/.test(to)) { status.textContent = 'Enter the number in international format, for example +12125550100.'; return; }
    if (!purpose) { status.textContent = 'Write what the AI should say or ask.'; return; }
    if (api.isLocalPreview) { status.textContent = 'Calls work on the live site, not in the local preview.'; return; }
    button.disabled = true; status.textContent = 'Starting the call…';
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-phone-call', { method:'POST', body:JSON.stringify({ business_id:businessId, to, purpose }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(({ no_outgoing_line:'Your number cannot make calls yet.', other_country:'Your AI can only call numbers in the same country as your Hansora number.', credits_required:'Add credits to make calls.', too_many_calls:'Too many calls in a short time. Please wait a few minutes.', invalid_number:'This number is not valid.', phone_agent_configuration_incomplete:'Finish setting up your AI employee first.' })[payload.error] || 'The call could not be started. Please try again.');
      status.textContent = `Calling ${payload.calling} from ${payload.from}… The call appears in Recent calls below.`;
      setTimeout(loadCalls, 60000);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  // The language choice in Rules: the caller's language, or only the ones the owner ticks.
  function renderLanguages(selected) {
    const list = $('#language-list');
    const picked = new Set(Array.isArray(selected) ? selected : chosenLanguages());
    const codes = [...new Set([...agentLanguages, ...Object.keys(LANGUAGES)])];
    list.innerHTML = codes.map(code => `<label class="ui-badge" style="cursor:pointer;padding:7px 11px;gap:6px"><input type="checkbox" value="${code}"${picked.has(code) ? ' checked' : ''}> ${escapeHtml(LANGUAGES[code])}</label>`).join('');
    const only = languageMode() === 'only';
    list.hidden = !only; list.style.display = only ? 'flex' : 'none';
    $('#language-hint').textContent = only
      ? 'The AI speaks only the ticked languages: it answers in the caller’s language when it is one of them, keeps it for the whole call, and never switches to another language.'
      : 'The AI answers in the language the caller speaks and keeps it for the whole call.';
  }
  function render() {
    stopVoice();
    if (step === 2) preloadVoices();
    document.querySelectorAll('.phone-step').forEach(pane => { pane.hidden = Number(pane.dataset.phoneStep) !== step; });
    document.querySelectorAll('.ui-stepper li').forEach(item => { const n = Number(item.dataset.step); item.classList.toggle('active', n === step); item.classList.toggle('done', n < step); });
    $('.ui-stepper').style.setProperty('--progress-num', String((step - 1) / 3));
    $('#phone-previous').hidden = step === 1;
    $('#phone-next').textContent = step === 4 ? (canGetNumber() ? getNumberLabel() : editing ? 'Save changes' : 'Save phone setup') : 'Continue';
    // With a number already live, step 1 has nothing to continue to until the owner picks something new to add.
    $('#phone-next').hidden = step === 1 && mode() === 'none' && liveNumbers().length > 0;
    if (liveNumbers().length) $('#phone-save-state').textContent = 'These settings apply to all this AI employee’s numbers';
    // A new Hansora number belongs to the AI alone, so it answers every call; the choice only matters when forwarding.
    $('#answer-mode-field').hidden = currentMode() !== 'forward';
    if (step === 4) renderReview();
  }
  function renderReview() {
    const data = collect();
    const answer = { no_answer:'If you don’t answer or are busy' }[data.answer_mode] || 'Every call';
    const numbers = liveNumbers().map(item => item.e164).join(', ') || (data.number_mode === 'whatsapp' ? 'WhatsApp · calls coming soon' : 'Not set up yet');
    const languages = data.language_mode === 'only' ? data.languages.map(code => LANGUAGES[code]).join(', ') : 'The caller’s language';
    // Each card opens the step where it is changed, so the owner can edit right after a test call.
    $('#phone-review').innerHTML = [['Number', numbers, 1], ['Voice', data.voice, 2], ['Answers', answer, 3], ['Languages', languages, 3], ['Transfer to', data.transfer_on && data.transfer_number ? data.transfer_number : 'Takes a message', 3]].map(([label, value, target]) => `<button type="button" data-edit-step="${target}" title="Change ${label.toLowerCase()}"><span>${label}<em>Edit</em></span><strong>${escapeHtml(value)}</strong></button>`).join('');
    // Tells the owner plainly whether real calls are answered yet, and what is left to do.
    const live = liveNumbers().length
      ? `<div class="ui-note" style="border-color:rgba(52,199,89,.4)"><strong style="color:var(--text)">Live.</strong> Your AI employee answers calls to <strong style="color:var(--text)">${liveNumbers().map(item => escapeHtml(item.e164)).join(', ')}</strong>.${data.number_mode === 'forward' ? '' : ' Call it from any phone to check.'}${canGetNumber() ? ` To add your ${escapeHtml(countryName(targetCountry()))} number, click <strong>${escapeHtml(getNumberLabel())}</strong> below.` : ''}</div>`
      : '';
    const next = liveNumbers().length ? ''
      : canGetNumber() ? `<div class="ui-note" style="border-color:rgba(255,184,0,.45)"><strong style="color:var(--text)">Not live yet.</strong> Click <strong>${escapeHtml(getNumberLabel())}</strong> below and your number is ready in seconds. The test above already works.</div>`
        : line.where ? `<div class="ui-note" style="border-color:rgba(255,184,0,.45)"><strong style="color:var(--text)">Not live yet.</strong> The test above already works.<div style="margin-top:12px">${notLiveOffer()}</div></div>`
          : '<div class="ui-note" style="border-color:rgba(255,184,0,.45)"><strong style="color:var(--text)">Not live yet.</strong> Choose where your business is in step 1. <button class="ui-btn ghost" type="button" id="phone-go-number" style="border:1px solid var(--border);margin-top:10px">Choose your country</button></div>';
    $('#phone-live').innerHTML = live + next;
    $('#phone-go-number')?.addEventListener('click', () => { step = 1; render(); });
  }
  async function save({ quiet = false } = {}) {
    const data = { ...collect(), saved_at:new Date().toISOString() };
    if (api.isLocalPreview) { try { localStorage.setItem(STORAGE, JSON.stringify(data)); localStorage.setItem('hansora_automation_phone_ready', '1'); } catch (_) {} }
    else {
      const result = await api.db.from('automation_channel_connections').update({ settings:data }).eq('business_id', businessId).eq('channel_type', 'phone');
      if (result.error) { showError(api.displayError(result.error)); return false; }
    }
    saved = data;
    setState();
    if (!quiet) ui.toast(liveNumbers().length ? 'Saved. Your AI employee answers calls with these settings.' : 'Saved. Not live yet: get your number on this step.');
    if (step === 4) render();
    return true;
  }
  // "Live" only once the business really has a number; settings alone do not make calls work.
  function setState() { const badge = $('#phone-state'); const live = liveNumbers(); const count = live.length; badge.textContent = count ? `Live · ${count === 1 ? live[0].e164 : `${count} numbers`}` : 'Not live yet'; badge.classList.toggle('green', count > 0); badge.classList.remove('amber'); }

  // The business's Hansora numbers. Assigned and released only by the server.
  async function loadLine() {
    if (api.isLocalPreview) { line.loaded = true; line.countries = [{ country:'US', available:1 }, { country:'CA', available:1 }]; renderLine(); setState(); return; }
    try {
      const response = await api.authenticatedFetch(`/.netlify/functions/automation-phone-line?business_id=${encodeURIComponent(businessId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'phone_line_unavailable');
      const numbers = Array.isArray(payload.numbers) ? payload.numbers : payload.number ? [payload.number] : [];
      line = { ...line, numbers, countries:payload.countries || [], requests:payload.requests || [], sip:payload.sip || null, loaded:true, error:false };
    } catch (_) { line = { ...line, numbers:[], countries:[], loaded:true, error:true }; }
    keepSipMode();
    renderLine(); setState(); render();
    if (!line.numbers.length && !line.error) recordCountry();
  }
  function countryName(code) { try { return new Intl.DisplayNames([navigator.language || 'en'], { type:'region' }).of(code) || code; } catch (_) { return code; } }
  function readyCountries() { return new Set(line.countries.map(item => item.country)); }
  function numberIn(country) { return line.numbers.find(item => item.country === country && !item.imported); }
  // Numbers that really answer calls (an imported SIP number counts once its first call has arrived).
  function liveNumbers() { return line.numbers.filter(item => !item.pending); }
  // Nothing is chosen for the owner. While a SIP number waits for its test call, the owner is continuing with SIP.
  // With a live number, no option is chosen either: "Edit settings" changes it, and the options only add something new.
  function keepSipMode() {
    const sipRadio = document.querySelector('input[name="number-mode"][value="sip"]');
    const noneRadio = document.querySelector('input[name="number-mode"][value="none"]');
    if (!line.modeTouched) {
      if (line.numbers.some(item => item.pending)) sipRadio.checked = true;
      else if (liveNumbers().length) noneRadio.checked = true;
    }
    if (sipRadio.checked && !line.numbers.some(item => item.imported)) noneRadio.checked = true;
    $('#forward-field').hidden = mode() !== 'forward'; $('#answer-mode-field').hidden = currentMode() !== 'forward';
  }
  function fallbackCountry() { return ['US', 'CA'].find(code => readyCountries().has(code)); }
  // The country the last step's button gets a number in: the business's own country, or a
  // US/Canada number to forward to when there are no local numbers yet.
  function targetCountry() {
    if (!line.where || ['none', 'whatsapp', 'sip'].includes(mode())) return '';
    if (readyCountries().has(line.where)) return line.where;
    return mode() === 'forward' ? fallbackCountry() || '' : '';
  }
  function canGetNumber() { const country = targetCountry(); return line.loaded && !line.error && Boolean(country) && !numberIn(country); }
  function getNumberLabel() { const country = targetCountry(); return country === line.where ? `Save and get my ${countryName(country)} number` : `Save and get a ${countryName(country)} number to forward to`; }
  function renderLine() {
    if (!line.loaded) return;
    if (line.error) { $('#option-detail').innerHTML = '<p class="ui-hint">Phone numbers could not be loaded. Refresh the page to try again.</p>'; return; }
    const where = line.where, name = escapeHtml(countryName(where));
    const local = !where || readyCountries().has(where);
    // Where Hansora has no numbers yet, only forwarding and WhatsApp are offered.
    const newOption = document.querySelector('input[name="number-mode"][value="new"]');
    newOption.disabled = !local;
    newOption.closest('.ui-option').style.display = local ? '' : 'none';
    if (!local && newOption.checked) { document.querySelector('input[name="number-mode"][value="none"]').checked = true; $('#forward-field').hidden = true; }
    // Numbers the business already has come first; adding another country comes below them.
    const numbers = liveNumbers();
    $('#line-numbers').innerHTML = numbers.length ? `<div class="ui-step-head" style="margin-bottom:12px"><h2>Your phone ${numbers.length === 1 ? 'number' : 'numbers'}</h2><p>Your AI employee answers every call to ${numbers.length === 1 ? 'it' : 'them'}.</p></div>${numbers.map(number => `<div class="line-number-card"><small class="ui-faint">${escapeHtml(countryName(number.country))} · ${number.imported ? 'Your SIP number · Live' : 'Live'}</small><strong class="big">${escapeHtml(number.e164)}</strong>${number.imported ? '' : forwardingHtml(number) || alsoForwardHtml(number)}<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button class="ui-btn primary" type="button" data-line-action="edit">Edit settings</button><button class="ui-btn ghost" type="button" data-line-action="release" data-e164="${escapeHtml(number.e164)}" style="border:1px solid var(--border)">Turn off this number</button></div></div>`).join('')}` : '';
    // A SIP number that is not connected yet comes first: it is what the owner is in the middle of.
    const finishing = finishSipHtml();
    if (finishing) $('#line-numbers').innerHTML += finishing;
    $('#line-title').textContent = numbers.length ? 'Add another number' : finishing ? 'Or connect another way' : 'How customers reach you';
    $('#line-subtitle').textContent = numbers.length ? 'Only choose one of these to add something new. To change the voice, greeting or languages, press Edit settings above.' : 'Pick one. You can change it later.';
    $('#line-contact').innerHTML = where && !local ? contactCard() : '';
    $('#sip-import').innerHTML = sipImportHtml();
    renderOutgoing();
    // Each option's details sit right under the options.
    const fallback = fallbackCountry();
    $('#forward-info').innerHTML = !where ? ''
      : local ? `You get a local ${name} number on the last step. Then forward your business phone to it, at local rates.`
        : fallback ? `On the last step you get a ${escapeHtml(countryName(fallback))} number, and your business phone forwards calls to it. <strong style="color:var(--text)">Each forwarded call goes abroad, so your operator charges international rates.</strong> Check the price with your operator first.` : '';
    const detail = mode() === 'whatsapp' ? whatsappDetail()
      : mode() === 'new' ? (!where ? '<p class="ui-hint" style="margin:0">Choose where your business is first.</p>'
        : numberIn(where) ? `<p class="ui-hint" style="margin:0">You already have a ${name} number (above). Choose another country to add one more.</p>`
          : `<p class="ui-hint" style="margin:0">Your ${name} number is ready on the last step, with one click. Customers call it and your AI answers right away.</p>`)
      : '';
    $('#option-detail').innerHTML = detail;
    $('#option-detail').hidden = !detail;
    // The chosen option's details go right under that option.
    const chosen = document.querySelector('input[name="number-mode"]:checked')?.closest('.ui-option');
    chosen?.after?.(mode() === 'forward' ? $('#forward-field') : $('#option-detail'));
  }
  // The codes that send the owner's business calls to the Hansora number.
  function forwardingHtml(number) {
    const dial = escapeHtml(number.e164);
    const codes = document.querySelector('input[name="answer-mode"]:checked')?.value === 'no_answer'
      ? [['When you don’t answer, are busy or unreachable', `**004*${dial}#`]]
      : [['All calls', `**21*${dial}#`]];
    return mode() !== 'forward' ? '' : `<div style="margin-top:14px"><strong>Turn on forwarding</strong><p class="ui-hint" style="margin:4px 0 8px">On the phone with your business number, dial this code and press call:</p>${codes.map(([label, code]) => `<div class="ui-setting" style="padding:8px 0"><span>${label}</span><code style="font-size:15px;user-select:all">${code}</code></div>`).join('')}<span class="ui-hint">Works on most mobile operators. To stop forwarding, dial <code>##002#</code>. Then call your business number from another phone to check.${line.where && line.where !== number.country ? ' This number is in another country, so your operator charges you for each forwarded call.' : ''}</span></div>`;
  }
  // A new number can take forwarded calls too: old customers keep calling the business's own phone, and it forwards here.
  function alsoForwardHtml(number) {
    const dial = escapeHtml(number.e164);
    const codes = [['All calls', `**21*${dial}#`], ['Only when you don’t answer, are busy or unreachable', `**004*${dial}#`]];
    return `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Also forward your existing phone to this number</summary><p class="ui-hint" style="margin:6px 0 8px">Your old customers keep calling the number they know, and your AI answers them too. On the phone with your existing number, dial one of these codes and press call:</p>${codes.map(([label, code]) => `<div class="ui-setting" style="padding:8px 0"><span>${label}</span><code style="font-size:15px;user-select:all">${code}</code></div>`).join('')}<span class="ui-hint">Works on most mobile operators. To stop forwarding, dial <code>##002#</code>.${line.where && line.where !== number.country ? ' This number is in another country, so your operator charges you for each forwarded call.' : ''}</span></details>`;
  }
  // For owners who already have a number on a SIP trunk (any provider): they add it here, and point
  // their provider at Hansora with the address, username and password shown.
  function sipImportHtml() {
    const sip = line.sip;
    const pending = line.numbers.filter(item => item.pending);
    const open = line.sipOpen ?? Boolean(sip);
    const row = (label, value) => `<div class="ui-setting" style="padding:8px 0"><span>${label}</span><code style="font-size:14px;user-select:all;word-break:break-all">${escapeHtml(value)}</code></div>`;
    const settings = sip ? `${row('SIP address', sip.address)}${row('Username', sip.username)}${row('Password', sip.password)}${row('Transport', sip.transport)}` : '';
    // A number stays "Not connected yet" until a real call arrives on it: that is the only proof the provider is set up.
    return sipDetailsHtml({ sip, pending, open, row, settings });
  }
  function finishSipHtml() {
    const sip = line.sip; const pending = line.numbers.filter(item => item.pending);
    const row = (label, value) => `<div class="ui-setting" style="padding:8px 0"><span>${label}</span><code style="font-size:14px;user-select:all;word-break:break-all">${escapeHtml(value)}</code></div>`;
    const settings = sip ? `${row('SIP address', sip.address)}${row('Username', sip.username)}${row('Password', sip.password)}${row('Transport', sip.transport)}` : '';
    return pending.map(number => `<div style="margin:12px 0;padding:16px;border:1px solid rgba(255,184,0,.45);border-radius:var(--radius-sm);background:var(--surface-2)"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><strong style="font-size:15px">Finish connecting ${escapeHtml(number.e164)}</strong><span class="ui-badge amber">Waiting for your test call</span></div><p class="ui-hint" style="margin:10px 0 4px"><strong>1.</strong> In your SIP provider, send incoming calls for this number to:</p>${settings}<p class="ui-hint" style="margin:10px 0 4px"><strong>2.</strong> Make a test call: call ${escapeHtml(number.e164)} from another phone. Your AI is ready and answers it.</p><p class="ui-hint" style="margin:0 0 12px"><strong>3.</strong> If your AI answered, your provider is set up and the number shows <strong>Live</strong> here. If the call did not reach your AI, check the settings in your provider and call again.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ui-btn secondary" type="button" data-line-action="check_sip">I called it, check again</button><button class="ui-btn ghost" type="button" data-line-action="release" data-e164="${escapeHtml(number.e164)}" style="border:1px solid var(--border)">Remove</button></div></div>`).join('');
  }
  function sipDetailsHtml({ sip, pending, open, row, settings }) {
    const reference = sip && !pending.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:13.5px">Your SIP settings</summary>${settings}</details>` : '';
    const form = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input class="ui-input" id="sip-number" type="tel" placeholder="Your SIP number, e.g. +37460000000" style="flex:1;min-width:200px"><button class="ui-btn primary" type="button" data-line-action="import_sip">Add my SIP number</button></div>`;
    return `<details data-sip${open || pending.length ? ' open' : ''}><summary style="cursor:pointer;color:var(--text-2);font-size:13.5px">Already have a SIP trunk number? Use it with your AI</summary><p class="ui-hint" style="margin:8px 0 0">Only for numbers on a <strong>SIP trunk</strong> (your phone provider gave you SIP settings). A normal mobile or landline number? Use <strong>Forward your existing number</strong> instead. Your provider keeps the number and bills you for the line; your AI answers its calls, billed per minute.</p>${reference}${form}</details>`;
  }
  function requestFor(country) { return line.requests.find(item => item.country === country); }
  function lastContact() { return line.requests.find(item => item.contact_value) || null; }
  // One clear box for countries without numbers: the owner leaves WhatsApp or Telegram, and Hansora sets it up with them.
  function contactCard() {
    const name = escapeHtml(countryName(line.where));
    const request = requestFor(line.where);
    if (request?.contact_value && request.wants_local_number) return `<div class="ui-note" style="margin:0 0 18px;border-color:rgba(52,199,89,.4)"><strong style="color:var(--text)">Thanks! We’ll contact you within a day</strong> on ${escapeHtml(CONTACT_METHODS[request.contact_method]?.[0] || 'your contact')} at <strong style="color:var(--text)">${escapeHtml(request.contact_value)}</strong> to set up your ${name} number.</div>`;
    const known = lastContact();
    const method = CONTACT_METHODS[known?.contact_method] ? known.contact_method : 'whatsapp';
    return `<div class="contact-box" data-wants="local_number" style="margin:0 0 18px;padding:18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2)"><strong style="display:block;font-size:15px">Want a local ${name} number?</strong><p class="ui-hint" style="margin:4px 0 12px">Leave your WhatsApp or Telegram and we’ll set it up with you, usually within a day.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><select class="ui-input" data-contact-method style="width:auto;min-width:130px">${Object.entries(CONTACT_METHODS).map(([value, [label]]) => `<option value="${value}"${value === method ? ' selected' : ''}>${label}</option>`).join('')}</select><input class="ui-input" data-contact-value value="${escapeHtml(known?.contact_value || '')}" placeholder="${escapeHtml(CONTACT_METHODS[method][1])}" style="flex:1;min-width:180px"><button class="ui-btn primary" type="button" data-line-action="contact">Contact me</button></div></div>`;
  }
  // WhatsApp: the business connects its WhatsApp; calls on it are answered once WhatsApp calling opens.
  function whatsappDetail() {
    return `<div style="display:flex;gap:14px;align-items:flex-start;padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm)"><span aria-hidden="true" style="flex:none;width:40px;height:40px;border-radius:50%;background:#25d366;color:#fff;display:grid;place-items:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5.1 5.24-1.37A9.9 9.9 0 1 0 12.04 2Zm4.5 11.95c-.25-.12-1.46-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.71-1.33.08-.16.04-.3-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.48a.92.92 0 0 0-.66.31 2.78 2.78 0 0 0-.87 2.07 4.83 4.83 0 0 0 1.01 2.56 11.05 11.05 0 0 0 4.23 3.74c.59.26 1.05.41 1.41.52a3.4 3.4 0 0 0 1.56.1c.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.29Z"/></svg></span><div style="flex:1"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong>WhatsApp messages and calls</strong><span class="ui-badge amber">Coming soon</span></div><p class="ui-hint" style="margin:4px 0 12px">Soon your AI employee answers your WhatsApp messages and calls, in any country, with no phone number to buy.</p><span class="ui-btn secondary" aria-disabled="true" style="opacity:.6;cursor:default">Coming soon</span></div></div>`;
  }
  function notLiveOffer() { return mode() === 'whatsapp' ? whatsappDetail() : line.where && !readyCountries().has(line.where) ? contactCard() : ''; }
  function showCelebration(number) {
    $('#celebrate-number').textContent = number.e164;
    $('#celebrate-country').textContent = `${countryName(number.country)} number`;
    $('#celebrate-forward').innerHTML = forwardingHtml(number);
    $('#phone-celebrate').hidden = false;
    $('#celebrate-done').focus();
  }
  async function lineAction(action, button) {
    // Goes to the settings steps; no number is bought and nothing changes until Save.
    if (action === 'edit') { editing = true; line.modeTouched = false; keepSipMode(); renderLine(); step = 2; render(); window.scrollTo?.(0, 0); return; }
    let extra = {};
    const imported = action === 'release' && line.numbers.some(item => item.e164 === button.dataset.e164 && item.imported);
    if (action === 'release' && !confirm(imported ? `Remove ${button.dataset.e164} from your AI? Your provider keeps the number; your AI stops answering it.` : `Turn off ${button.dataset.e164 || 'this number'}? Calls to it will no longer be answered, and the number may be given to another business.`)) return;
    if (action === 'release') extra = { e164:button.dataset.e164 };
    // "Check again": reload the numbers; a SIP number that has received its first call is connected now.
    if (action === 'check_sip') { button.disabled = true; await loadLine(); button.disabled = false; ui.toast(line.numbers.some(item => item.pending) ? 'No test call has reached your AI yet. Check the settings in your provider and call the number again.' : 'Connected! Your number is live.'); return; }
    if (action === 'import_sip') {
      const value = $('#sip-number').value.trim();
      if (!/^\+?[\d\s()-]{8,20}$/.test(value)) { showError('Enter your SIP number in international format, for example +37460000000.'); return; }
      extra = { e164:value, country:line.where || '' };
    }
    if (action === 'contact') {
      const box = button.closest('.contact-box');
      const method = box.querySelector('[data-contact-method]').value, value = box.querySelector('[data-contact-value]').value.trim();
      if (!value) { showError(`Enter your ${CONTACT_METHODS[method][0]}.`); return; }
      extra = { method, value, wants:[...box.dataset.wants.split(','), ...(mode() === 'forward' ? ['forwarding_help'] : [])], country:line.where };
    }
    button.disabled = true; $('#phone-error').hidden = true;
    try {
      if (api.isLocalPreview && action !== 'activate' && action !== 'release') throw new Error('This works on the live site, not in the local preview.');
      // The local preview pretends to get and turn off a number, so the flow can be tried without the server.
      const response = api.isLocalPreview ? previewLineResponse(action, button.dataset.country, extra.e164) : await api.authenticatedFetch('/.netlify/functions/automation-phone-line', { method:'POST', body:JSON.stringify({ business_id:businessId, action, country:button.dataset.country, ...extra }) });
      const payload = await response.json().catch(() => ({}));
      if (action === 'contact') {
        if (!response.ok) throw new Error(payload.error === 'invalid_contact' ? `Please check your ${CONTACT_METHODS[extra.method][0]}.` : 'Your contact could not be saved. Please try again.');
        const flags = Object.fromEntries(extra.wants.map(item => [`wants_${item}`, true]));
        const others = line.requests.filter(item => item.country !== extra.country);
        line.requests = [{ ...(requestFor(extra.country) || {}), country:extra.country, contact_method:extra.method, contact_value:extra.value, ...flags }, ...others];
        ui.toast('Thanks! We’ll contact you within a day.'); renderLine(); if (step === 4) render(); return;
      }
      if (action === 'import_sip') {
        if (!response.ok) throw new Error({ number_in_use:'This number is already used by another Hansora account. Contact us if it is yours.', number_already_added:'This number is already added.', invalid_country:'Choose where your business is (above) first.', invalid_number:'Enter the number in international format, for example +37460000000.', too_many_imported_numbers:'You can add up to 10 SIP numbers.', phone_agent_configuration_incomplete:'Finish setting up your AI employee first.', phone_line_setup_failed:'The number could not be added right now. Please try again in a few minutes.' }[payload.error] || 'The number could not be added. Please try again.');
        line.numbers = Array.isArray(payload.numbers) ? payload.numbers : line.numbers;
        line.sip = payload.sip || line.sip; line.sipOpen = true; line.modeTouched = false; keepSipMode();
        await save({ quiet:true });
        ui.toast('Added. Enter these settings in your SIP provider, then make a test call.'); renderLine(); setState(); if (step === 4) render(); return;
      }
      if (!response.ok) throw new Error(({ no_number_available:'No number could be set up in that country right now. Please choose another or contact us.', phone_agent_configuration_incomplete:'Finish setting up your AI employee first.', credits_required:'Add credits to your account to get a phone number.', phone_line_setup_failed:'Your number is being set up. Please try again in a few minutes or contact us.' }[payload.error] || 'The phone line could not be changed. Please try again.') + (payload.detail ? ` (${payload.detail})` : ''));
      line.numbers = Array.isArray(payload.numbers) ? payload.numbers : payload.number ? [payload.number] : [];
      if (action === 'activate') { await save({ quiet:true }); line.modeTouched = false; keepSipMode(); if (payload.number) showCelebration(payload.number); }
      else { if (!line.numbers.some(item => item.imported)) line.sip = null; line.modeTouched = false; keepSipMode(); ui.toast(imported ? 'Number removed.' : 'Number turned off.'); }
      renderLine(); setState(); render();
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; }
  }

  function previewLineResponse(action, country, e164) {
    const numbers = action === 'activate' ? [...line.numbers, { e164:`+1555010${String(100 + line.numbers.length)}`, country }] : line.numbers.filter(item => item.e164 !== e164);
    return { ok:true, json:async () => ({ numbers, number:action === 'activate' ? numbers[numbers.length - 1] : numbers[0] || null }) };
  }
  async function loadCalls() {
    const list = $('#phone-calls-list'); if (!list) return;
    if (api.isLocalPreview) { list.innerHTML = '<p class="ui-hint">Calls appear here.</p>'; return; }
    const result = await api.db.from('automation_calls').select('id,direction,status,started_at,ended_at,billable_seconds,transcript,outcome').eq('business_id', businessId).order('started_at', { ascending:false }).limit(20);
    if (result.error) { list.innerHTML = '<p class="ui-hint">Calls could not be loaded.</p>'; return; }
    const calls = result.data || [];
    if (!calls.length) { list.innerHTML = '<p class="ui-hint">No calls yet. Test calls from step 4 appear here too.</p>'; return; }
    list.innerHTML = calls.map(call => {
      const seconds = call.ended_at ? Math.max(0, Math.round((Date.parse(call.ended_at) - Date.parse(call.started_at)) / 1000)) : 0;
      const who = call.direction === 'test' ? 'Test call' : (call.outcome?.caller_number || 'Caller');
      const when = new Date(call.started_at).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      const state = call.ended_at ? formatTimer(seconds) : 'In progress';
      const lines = String(call.transcript || '').split('\n').filter(Boolean).map(text => { const ai = text.startsWith('AI:'); return `<p class="${ai ? 'ai' : 'caller'}"><span>${ai ? 'AI employee' : 'Caller'}</span>${escapeHtml(text.replace(/^(AI|Caller):\s*/, ''))}</p>`; }).join('');
      return `<details class="ui-setting" style="display:block;padding:12px 0"><summary style="display:flex;justify-content:space-between;gap:12px;cursor:pointer"><span><strong>${escapeHtml(who)}</strong> <small class="ui-faint">${escapeHtml(when)}</small></span><span class="ui-faint">${escapeHtml(state)}</span></summary>${lines ? `<div class="ui-transcript" style="margin-top:10px">${lines}</div>` : '<p class="ui-hint">No transcript for this call.</p>'}</details>`;
    }).join('');
  }
  async function previewCall(button) {
    button.disabled = true;
    const orb = $('#call-orb'); orb.classList.add('ringing'); $('#call-status').textContent = 'Calling…';
    const transcript = $('#phone-transcript'); transcript.innerHTML = '';
    await wait(900); orb.classList.remove('ringing'); orb.classList.add('live'); $('#call-status').textContent = 'Connected · local preview';
    let seconds = 0; const timer = setInterval(() => { seconds++; $('#call-timer').textContent = `${formatTimer(seconds)} · preview · not billed`; }, 1000);
    const lines = [['ai', $('#phone-greeting').value.trim() || 'Hello! How can I help?'], ['caller', 'I would like to book a measurement visit.'], ['ai', 'Of course. Friday has 11:30 and 15:00 free. Which suits you?'], ['caller', '11:30, please.'], ['ai', 'Booked for Friday at 11:30. Your reference is 1042. Anything else?']];
    for (const [who, text] of lines) { await wait(1100); transcript.insertAdjacentHTML('beforeend', `<p class="${who}"><span>${who === 'ai' ? 'AI employee' : 'Caller'}</span>${escapeHtml(text)}</p>`); transcript.scrollTop = transcript.scrollHeight; }
    await wait(900); clearInterval(timer); orb.classList.remove('live'); $('#call-status').textContent = 'Call ended'; button.disabled = false; button.lastChild.textContent = 'Call again';
  }
  function formatTimer(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function showError(message) { const box = $('#phone-error'); box.textContent = message; box.hidden = false; }
  function fail(message) { $('#phone-loading').hidden = true; showError(message); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
