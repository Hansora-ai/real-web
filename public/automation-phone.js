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
  let step = 1;
  let liveRoom = null;
  let callTimer = null;
  let callStartedAt = 0;
  const transcriptSegments = new Map();

  let saved = {};
  if (api.isLocalPreview) { try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch (_) {} }
  else if (/^[0-9a-f-]{36}$/i.test(businessId)) {
    const result = await api.db.from('automation_channel_connections').select('status,settings').eq('business_id', businessId).eq('channel_type', 'phone').maybeSingle();
    if (result.error) return fail(api.displayError(result.error));
    saved = result.data?.settings || {};
  } else return fail('Open phone setup from your AI employee workspace.');
  applySaved(saved);
  $('#phone-loading').hidden = true; $('#phone-app').hidden = false;
  render();

  document.querySelectorAll('input[name="number-mode"]').forEach(input => input.addEventListener('change', syncForward));
  document.querySelectorAll('.ui-stepper li').forEach(item => item.addEventListener('click', () => { const target = Number(item.dataset.step); if (target < step) { step = target; render(); } }));
  $('#phone-previous').addEventListener('click', () => { if (step > 1) { step--; render(); } });
  $('#phone-next').addEventListener('click', async () => {
    if (step === 1 && mode() === 'forward' && !/^\+?[\d\s()-]{8,20}$/.test($('#phone-number').value.trim())) { showError('Enter the business number to forward.'); return; }
    $('#phone-error').hidden = true;
    if (step < 4) { step++; render(); return; }
    await save();
  });
  $('#test-call').addEventListener('click', testCall);

  function mode() { return document.querySelector('input[name="number-mode"]:checked').value; }
  function syncForward() { $('#forward-field').hidden = mode() !== 'forward'; }
  function collect() {
    return { number_mode:mode(), forward_number:$('#phone-number').value.trim(), voice:'Laomedeia', voice_model:'gemini-3.8-live', greeting:$('#phone-greeting').value.trim(), answer_mode:document.querySelector('input[name="answer-mode"]:checked').value, transfer_number:$('#transfer-number').value.trim(), save_transcripts:$('#save-transcripts').checked };
  }
  function applySaved(data) {
    if (data.number_mode) document.querySelector(`input[name="number-mode"][value="${data.number_mode}"]`)?.click();
    if (data.forward_number) $('#phone-number').value = data.forward_number;
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
    const answer = { always:'Every call', after_hours:'After working hours', no_answer:'If nobody picks up' }[data.answer_mode];
    $('#phone-review').innerHTML = [['Number', data.number_mode === 'new' ? 'New phone number' : `Forward ${data.forward_number}`], ['Voice', 'Laomedeia'], ['Answers', answer], ['Transfer to', data.transfer_number || 'Callback request']].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
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
  function setState(saved) { const badge = $('#phone-state'); badge.textContent = saved ? 'Saved · waiting for line' : 'Not set up'; badge.classList.toggle('amber', saved); }
  async function testCall(event) {
    if (liveRoom) { await endLiveCall(); return; }
    if (api.isLocalPreview) { await previewCall(event.currentTarget); return; }
    const button = event.currentTarget; button.disabled = true;
    $('#phone-error').hidden = true;
    if (!window.LivekitClient) { showError('The secure call client could not load. Refresh and try again.'); button.disabled = false; return; }
    if (!await save({ quiet:true })) { button.disabled = false; return; }
    const orb = $('#call-orb'); orb.classList.add('ringing'); $('#call-status').textContent = 'Calling…';
    const transcript = $('#phone-transcript'); transcript.innerHTML = '';
    transcriptSegments.clear();
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-phone-token', { method:'POST', body:JSON.stringify({ business_id:businessId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(phoneError(payload.error));
      const lk = window.LivekitClient;
      const room = new lk.Room({ adaptiveStream:true, dynacast:true });
      liveRoom = room;
      room.on(lk.RoomEvent.TrackSubscribed, track => { if (track.kind === lk.Track.Kind.Audio) { const element = track.attach(); element.autoplay = true; element.dataset.phoneAudio = '1'; document.body.appendChild(element); } });
      room.on(lk.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
      room.on(lk.RoomEvent.TranscriptionReceived, (segments, participant) => { segments.forEach(segment => { if (segment.final && segment.text.trim()) transcriptSegments.set(segment.id, { who:participant === room.localParticipant ? 'caller' : 'ai', text:segment.text.trim(), at:segment.startTime }); }); renderTranscript(); });
      room.on(lk.RoomEvent.Disconnected, () => finishCallUi('Call ended'));
      room.on(lk.RoomEvent.MediaDevicesError, error => showError(error?.message || 'Microphone access failed.'));
      await room.connect(payload.url, payload.token, { autoSubscribe:true });
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation:true, noiseSuppression:true, autoGainControl:true });
      orb.classList.remove('ringing'); orb.classList.add('live'); $('#call-status').textContent = 'Connected · speak naturally';
      button.disabled = false; button.textContent = 'End test call'; button.classList.add('danger'); button.classList.remove('accent');
      callStartedAt = Date.now();
      callTimer = setInterval(updateTimer, 1000); updateTimer();
    } catch (error) {
      if (liveRoom) { await liveRoom.disconnect().catch(() => {}); liveRoom = null; }
      orb.classList.remove('ringing', 'live');
      $('#call-status').textContent = 'Test call unavailable';
      $('#call-timer').textContent = 'Check the message above, then try again';
      showError(error?.message || 'Could not start the live test call.');
      button.disabled = false; button.textContent = 'Try again';
    }
  }
  async function endLiveCall() {
    const room = liveRoom; liveRoom = null;
    if (room) { await room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); await room.disconnect().catch(() => {}); }
    finishCallUi('Call ended');
  }
  function finishCallUi(status) {
    if (callTimer) clearInterval(callTimer); callTimer = null;
    document.querySelectorAll('[data-phone-audio]').forEach(element => element.remove());
    $('#call-orb').classList.remove('ringing', 'live'); $('#call-status').textContent = status;
    const button = $('#test-call'); button.disabled = false; button.textContent = 'Call again'; button.classList.remove('danger'); button.classList.add('accent');
    const seconds = callStartedAt ? Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)) : 0;
    $('#call-timer').textContent = `${formatTimer(seconds)} · test call · not billed`;
    liveRoom = null;
  }
  function updateTimer() { $('#call-timer').textContent = `${formatTimer(Math.floor((Date.now() - callStartedAt) / 1000))} · live · not billed`; }
  function formatTimer(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  function renderTranscript() {
    $('#phone-transcript').innerHTML = [...transcriptSegments.values()].sort((a,b) => a.at - b.at).map(item => `<p class="${item.who}"><span>${item.who === 'ai' ? 'AI employee' : 'You'}</span>${escapeHtml(item.text)}</p>`).join('');
    $('#phone-transcript').scrollTop = $('#phone-transcript').scrollHeight;
  }
  function phoneError(code) {
    return ({ phone_service_not_configured:'Live phone testing will be available after the LiveKit keys are added.', phone_test_unavailable:'The phone service is temporarily unavailable.', business_not_found:'This AI employee could not be found.' })[code] || 'Could not start the live test call.';
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
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function showError(message) { const box = $('#phone-error'); box.textContent = message; box.hidden = false; }
  function fail(message) { $('#phone-loading').hidden = true; showError(message); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
