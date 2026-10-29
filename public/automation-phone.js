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


  let saved = {};
  let line = { number:null, countries:[], loaded:false, where:'' };
  // Every country an owner can pick. Countries where local numbers are being
  // prepared (paperwork or a local operator) are marked as coming soon.
  const ALL_COUNTRIES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'.split(' ');
  const COMING_SOON = new Set('AM RU BR CH CZ DO EE HK ID IT KR LT LV NZ PL RO SE SG SI SK TH TR ZA'.split(' '));
  if (api.isLocalPreview) { try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch (_) {} }
  else if (/^[0-9a-f-]{36}$/i.test(businessId)) {
    const result = await api.db.from('automation_channel_connections').select('status,settings').eq('business_id', businessId).eq('channel_type', 'phone').maybeSingle();
    if (result.error) return fail(api.displayError(result.error));
    saved = result.data?.settings || {};
  } else return fail('Open phone setup from your AI employee workspace.');
  $('#line-where').insertAdjacentHTML('beforeend', ALL_COUNTRIES.map(code => [code, countryName(code)]).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => `<option value="${code}">${escapeHtml(name)}</option>`).join(''));
  applySaved(saved);
  $('#line-where').value = line.where;
  $('#phone-loading').hidden = true; $('#phone-app').hidden = false;
  render();
  loadLine();
  loadCalls();

  document.querySelectorAll('input[name="number-mode"]').forEach(input => input.addEventListener('change', syncForward));
  document.querySelectorAll('input[name="answer-mode"]').forEach(input => input.addEventListener('change', renderLine));
  $('#phone-line').addEventListener('click', event => { const button = event.target.closest('[data-line-action]'); if (button) lineAction(button.dataset.lineAction, button); });
  $('#line-where').addEventListener('change', event => { line.where = event.target.value; renderLine(); recordCountry(); });
  // Saved right away, so Hansora sees which countries owners want even if they leave.
  function recordCountry() {
    if (!api.isLocalPreview && line.where) api.authenticatedFetch('/.netlify/functions/automation-phone-line', { method:'POST', body:JSON.stringify({ business_id:businessId, action:'pick', country:line.where }) }).catch(() => {});
  }
  document.querySelectorAll('.ui-stepper li').forEach(item => item.addEventListener('click', () => { const target = Number(item.dataset.step); if (target < step) { step = target; render(); } }));
  $('#phone-previous').addEventListener('click', () => { if (step > 1) { step--; render(); } });
  $('#phone-next').addEventListener('click', async () => {
    if (step === 1 && mode() === 'forward' && !/^\+?[\d\s()-]{8,20}$/.test($('#phone-number').value.trim())) { showError('Enter the business number to forward.'); return; }
    $('#phone-error').hidden = true;
    if (step < 4) { step++; render(); return; }
    await save();
  });
  if (api.isLocalPreview) $('#test-call').addEventListener('click', event => previewCall(event.currentTarget));
  else window.HansoraVoiceTest.mount({
    api, businessId, getSettings:collect,
    elements:{ root:$('#phone-app'), button:$('#test-call'), orb:$('#call-orb'), status:$('#call-status'), timer:$('#call-timer'), error:$('#phone-error'), audio:$('#enable-call-audio'), transcript:$('#phone-transcript') }
  });

  function mode() { return document.querySelector('input[name="number-mode"]:checked').value; }
  function syncForward() { $('#forward-field').hidden = mode() !== 'forward'; renderLine(); }
  function collect() {
    return { number_mode:mode(), forward_number:$('#phone-number').value.trim(), voice:'Leda', voice_model:'gemini-3.8-live', greeting:$('#phone-greeting').value.trim(), answer_mode:document.querySelector('input[name="answer-mode"]:checked').value, transfer_number:$('#transfer-number').value.trim(), save_transcripts:$('#save-transcripts').checked, country:line.where || undefined };
  }
  function applySaved(data) {
    if (data.number_mode) document.querySelector(`input[name="number-mode"][value="${data.number_mode}"]`)?.click();
    if (data.forward_number) $('#phone-number').value = data.forward_number;
    if (ALL_COUNTRIES.includes(data.country)) line.where = data.country;
    if (data.greeting) $('#phone-greeting').value = data.greeting;
    if (data.answer_mode) { const input = document.querySelector(`input[name="answer-mode"][value="${data.answer_mode}"]`); if (input) input.checked = true; }
    if (data.transfer_number) $('#transfer-number').value = data.transfer_number;
    if (data.save_transcripts === false) $('#save-transcripts').checked = false;
    if (data.saved_at) setState(true);
    syncForward();
  }
  function render() {
    document.querySelectorAll('.phone-step').forEach(pane => { pane.hidden = Number(pane.dataset.phoneStep) !== step; });
    document.querySelectorAll('.ui-stepper li').forEach(item => { const n = Number(item.dataset.step); item.classList.toggle('active', n === step); item.classList.toggle('done', n < step); });
    $('.ui-stepper').style.setProperty('--progress-num', String((step - 1) / 3));
    $('#phone-previous').hidden = step === 1;
    $('#phone-next').textContent = step === 4 ? 'Save phone setup' : 'Continue';
    if (step === 4) renderReview();
  }
  function renderReview() {
    const data = collect();
    const answer = { no_answer:'If you don’t answer or are busy' }[data.answer_mode] || 'Every call';
    $('#phone-review').innerHTML = [['Number', line?.number ? line.number.e164 : (data.number_mode === 'new' ? 'New phone number' : `Forward ${data.forward_number}`)], ['Voice', 'Leda'], ['Answers', answer], ['Transfer to', data.transfer_number || 'Callback request']].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }
  async function save({ quiet = false } = {}) {
    const data = { ...collect(), saved_at:new Date().toISOString() };
    if (api.isLocalPreview) { try { localStorage.setItem(STORAGE, JSON.stringify(data)); localStorage.setItem('hansora_automation_phone_ready', '1'); } catch (_) {} }
    else {
      const result = await api.db.from('automation_channel_connections').update({ settings:data }).eq('business_id', businessId).eq('channel_type', 'phone');
      if (result.error) { showError(api.displayError(result.error)); return false; }
    }
    setState(true);
    if (!quiet) ui.toast('Phone setup saved. It goes live when the phone line is connected.');
    return true;
  }
  function setState(saved) { const badge = $('#phone-state'); const live = Boolean(line?.number); badge.textContent = live ? `Live · ${line.number.e164}` : saved ? 'Saved · waiting for line' : 'Not set up'; badge.classList.toggle('amber', saved && !live); badge.classList.toggle('green', live); }

  // The business's Hansora number. Assigned and released only by the server.
  async function loadLine() {
    if (api.isLocalPreview) { line.loaded = true; line.countries = [{ country:'US', available:1 }, { country:'CA', available:1 }]; return renderLine(); }
    try {
      const response = await api.authenticatedFetch(`/.netlify/functions/automation-phone-line?business_id=${encodeURIComponent(businessId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'phone_line_unavailable');
      line = { ...line, number:payload.number || null, countries:payload.countries || [], requested:payload.requested || [], loaded:true, error:false };
    } catch (_) { line = { ...line, number:null, countries:[], loaded:true, error:true }; }
    renderLine(); setState(Boolean(saved.saved_at));
    if (!line.number && !line.error) recordCountry();
  }
  function countryName(code) { try { return new Intl.DisplayNames([navigator.language || 'en'], { type:'region' }).of(code) || code; } catch (_) { return code; } }
  function renderLine() {
    const box = $('#phone-line'); if (!box || !line.loaded) return;
    if (line.error) { box.innerHTML = '<p class="ui-hint">Phone numbers could not be loaded. Refresh the page to try again.</p>'; return; }
    const number = line.number;
    const ready = new Set(line.countries.map(item => item.country));
    const where = line.where;
    const name = escapeHtml(countryName(where));
    // A new number is only offered where Hansora has local numbers; elsewhere the owner forwards.
    const newOption = document.querySelector('input[name="number-mode"][value="new"]');
    const canBuy = Boolean(number) || !where || ready.has(where);
    newOption.disabled = !canBuy;
    newOption.closest('.ui-option').style.opacity = canBuy ? '' : '.45';
    newOption.closest('.ui-option').querySelector('small').textContent = canBuy ? 'We assign it when you go live' : `Not available in ${countryName(where)} yet`;
    if (!canBuy && newOption.checked) { document.querySelector('input[name="number-mode"][value="forward"]').checked = true; $('#forward-field').hidden = false; }
    $('#line-where').disabled = Boolean(number);
    if (!number) {
      if (!where) { box.innerHTML = '<p class="ui-hint">Choose where your business is to see your phone options.</p>'; return; }
      if (ready.has(where)) {
        box.innerHTML = `<button class="ui-btn primary" type="button" data-line-action="activate" data-country="${where}">Get my ${name} number</button><span class="ui-hint">${mode() === 'forward' ? 'A local number: forward your business number to it at local rates. Calls are answered as soon as forwarding is on.' : 'Customers call this number. Calls are answered right away.'}</span>`;
        return;
      }
      // No local numbers here yet: the owner can still forward to a number abroad, at their operator's price.
      const fallback = ['US', 'CA'].find(code => ready.has(code));
      // Coming-soon countries collect owners to email when the country opens.
      const email = user?.email ? ` at <strong>${escapeHtml(user.email)}</strong>` : '';
      const notify = !COMING_SOON.has(where) ? ''
        : (line.requested || []).includes(where) ? `<p class="ui-hint">We’ll email you${email} when ${name} numbers are ready.</p>`
          : `<button class="ui-btn primary" type="button" data-line-action="notify" data-country="${where}">Notify me when ${name} numbers are ready</button><span class="ui-hint">We’ll email you${email}.</span>`;
      const status = COMING_SOON.has(where) ? `<strong>Local numbers in ${name} are coming soon.</strong>` : `<strong>Local numbers in ${name} are not available yet.</strong>`;
      const abroad = fallback ? `<div style="margin-top:16px"><strong>${notify ? 'Or start now' : 'Start now'} with forwarding</strong><p class="ui-hint" style="margin:4px 0 8px">Forward your business phone to a ${escapeHtml(countryName(fallback))} number. <strong>Your phone operator charges you for forwarding calls abroad</strong>, usually at the price of a call to that country. Check the price with your operator first.</p><button class="ui-btn ${notify ? 'ghost' : 'primary'}" type="button" data-line-action="activate" data-country="${fallback}" data-forward="1" style="border:1px solid var(--border)">Use a ${escapeHtml(countryName(fallback))} number with forwarding</button></div>` : '<p class="ui-hint">Your settings are saved, and you can test your AI employee in step 4.</p>';
      box.innerHTML = `<p class="ui-hint" style="margin-top:0">${status}</p>${notify}${abroad}`;
      return;
    }
    const dial = escapeHtml(number.e164);
    const codes = document.querySelector('input[name="answer-mode"]:checked')?.value === 'no_answer'
      ? [['When you don’t answer, are busy or unreachable', `**004*${dial}#`]]
      : [['All calls', `**21*${dial}#`]];
    const forward = mode() === 'forward' ? `<div style="margin-top:14px"><strong>Turn on forwarding</strong><p class="ui-hint" style="margin:4px 0 8px">On the phone with your business number, dial this code and press call:</p>${codes.map(([label, code]) => `<div class="ui-setting" style="padding:8px 0"><span>${label}</span><code style="font-size:15px;user-select:all">${code}</code></div>`).join('')}<span class="ui-hint">Works on most mobile operators. To stop forwarding, dial <code>##002#</code>. Then call your business number from another phone to check.${line.where && line.where !== number.country ? ' This number is in another country, so your operator charges you for each forwarded call.' : ''}</span></div>` : '';
    box.innerHTML = `<div class="ui-setting" style="padding:0"><span><strong>Your Hansora number</strong><small>${escapeHtml(countryName(number.country))} · your AI employee answers calls to it</small></span><strong style="font-size:18px;user-select:all">${dial}</strong></div>${forward}<button class="ui-btn ghost" type="button" data-line-action="release" style="margin-top:14px;border:1px solid var(--border)">Turn off phone line</button>`;
  }
  async function lineAction(action, button) {
    if (action === 'release' && !confirm('Turn off the phone line? Calls to this number will no longer be answered, and the number may be given to another business.')) return;
    // A number abroad only makes sense with forwarding: local customers keep calling the business number.
    if (button.dataset.forward) { document.querySelector('input[name="number-mode"][value="forward"]').checked = true; $('#forward-field').hidden = false; }
    button.disabled = true; $('#phone-error').hidden = true;
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-phone-line', { method:'POST', body:JSON.stringify({ business_id:businessId, action, country:button.dataset.country }) });
      const payload = await response.json().catch(() => ({}));
      if (action === 'notify' && response.ok) { line.requested = [...(line.requested || []), button.dataset.country]; ui.toast('Thanks! We’ll email you when it’s ready.'); renderLine(); return; }
      if (!response.ok) throw new Error({ no_number_available:'No number could be set up in that country right now. Please choose another or contact us.', phone_agent_configuration_incomplete:'Finish setting up your AI employee first.', credits_required:'Add credits to your account to get a phone number.', phone_line_setup_failed:'Your number is being set up. Please try again in a few minutes or contact us.' }[payload.error] || 'The phone line could not be changed. Please try again.');
      line.number = payload.number || null;
      if (action === 'activate') { await save({ quiet:true }); ui.toast(`Your number is ${line.number.e164}.`); }
      else { await loadLine(); ui.toast('Phone line turned off.'); }
      renderLine(); setState(true);
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; }
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
