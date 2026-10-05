(function () {
  'use strict';
  window.HansoraVoiceTest = {
    mount({ api, businessId, elements, getSettings = () => undefined, preview = false }) {
      const selectors = { '#test-call':'button', '#call-orb':'orb', '#call-status':'status', '#call-timer':'timer', '#phone-error':'error', '#enable-call-audio':'audio', '#phone-transcript':'transcript' };
      const $ = selector => elements[selectors[selector]];
      let liveRoom = null, callTimer = null, connectionTimer = null, limitTimer = null;
      let callStartedAt = 0, callMaxSeconds = 300;
      const transcriptSegments = new Map();
      const audioElements = new Set();
      elements.button.addEventListener('click', testCall);
      elements.audio.addEventListener('click', async () => {
        if (liveRoom) await liveRoom.startAudio().catch(() => showError('Audio could not start. Check your browser audio permissions.'));
      });
      window.addEventListener('pagehide', () => { endLiveCall().catch(() => {}); });
      return { end: endLiveCall };
  async function testCall(event) {
    if (liveRoom) { await endLiveCall(); return; }
    if (preview) { showError('Open your saved AI employee to make a real voice call.'); return; }
    const button = event.currentTarget; button.disabled = true;
    $('#phone-error').hidden = true;
    if (!window.LivekitClient) { showError('The secure call client could not load. Refresh and try again.'); button.disabled = false; return; }
    // A browser test needs no phone connection row or saved number setup.
    callStartedAt = 0;
    const orb = $('#call-orb'); orb.classList.add('ringing'); elements.root.dataset.callState = 'connecting'; $('#call-status').textContent = 'Calling…';
    const transcript = $('#phone-transcript'); if (transcript) transcript.innerHTML = '';
    transcriptSegments.clear();
    try {
      const response = await api.authenticatedFetch('/.netlify/functions/automation-phone-token', { method:'POST', body:JSON.stringify({ business_id:businessId, settings:getSettings() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(phoneError(payload.error));
      const lk = window.LivekitClient;
      const room = new lk.Room({ adaptiveStream:true, dynacast:true });
      liveRoom = room;
      callMaxSeconds = Number(payload.max_seconds) || 300;
      const markConnected = () => {
        if (liveRoom !== room || callStartedAt) return;
        clearTimeout(connectionTimer); connectionTimer = null;
        orb.classList.remove('ringing'); orb.classList.add('live'); elements.root.dataset.callState = 'listening'; $('#call-status').textContent = 'Connected · speak naturally';
        callStartedAt = Date.now();
        callTimer = setInterval(updateTimer, 1000); updateTimer();
        limitTimer = setTimeout(() => endLiveCall('Test time finished'), callMaxSeconds * 1000);
      };
      room.on(lk.RoomEvent.TrackSubscribed, track => { if (track.kind === lk.Track.Kind.Audio && liveRoom === room) { const element = track.attach(); element.autoplay = true; element.dataset.phoneAudio = '1'; document.body.appendChild(element); audioElements.add(element); markConnected(); } });
      room.on(lk.RoomEvent.ParticipantAttributesChanged, changed => { const state = changed['lk.agent.state']; if (['listening', 'thinking', 'speaking'].includes(state) && liveRoom === room) { markConnected(); elements.root.dataset.callState = state; } });
      room.on(lk.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => { element.remove(); audioElements.delete(element); }));
      room.on(lk.RoomEvent.TranscriptionReceived, (segments, participant) => { segments.forEach(segment => { if (segment.final && segment.text.trim()) transcriptSegments.set(segment.id, { who:participant === room.localParticipant ? 'caller' : 'ai', text:segment.text.trim(), at:segment.startTime }); }); renderTranscript(); });
      room.on(lk.RoomEvent.Disconnected, () => { if (liveRoom === room) finishCallUi('Call ended'); });
      room.on(lk.RoomEvent.MediaDevicesError, error => showError(error?.message || 'Microphone access failed.'));
      room.on(lk.RoomEvent.AudioPlaybackStatusChanged, () => { $('#enable-call-audio').hidden = room.canPlaybackAudio; });
      await room.connect(payload.url, payload.token, { autoSubscribe:true });
      if (liveRoom !== room) return;
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation:true, noiseSuppression:true, autoGainControl:true });
      if (liveRoom !== room) { await room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); return; }
      if (!callStartedAt) $('#call-status').textContent = 'Waiting for your AI employee…';
      button.disabled = false; button.textContent = 'Hang up'; button.classList.add('danger'); button.classList.remove('accent');
      if (!callStartedAt) connectionTimer = setTimeout(async () => { if (liveRoom !== room) return; await endLiveCall('Test call unavailable'); showError('Your AI employee could not join the call. Please try again shortly.'); }, 20000);
    } catch (error) {
      await endLiveCall('Test call unavailable');
      $('#call-timer').textContent = 'Check the message above, then try again';
      showError(error?.message || 'Could not start the live test call.');
      button.disabled = false; button.textContent = 'Try again';
    }
  }
  async function endLiveCall(status = 'Call ended') {
    const room = liveRoom; liveRoom = null;
    if (room) { await room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); await room.disconnect().catch(() => {}); }
    finishCallUi(status);
  }
  function finishCallUi(status) {
    if (callTimer) clearInterval(callTimer); callTimer = null;
    clearTimeout(connectionTimer); connectionTimer = null;
    clearTimeout(limitTimer); limitTimer = null;
    $('#enable-call-audio').hidden = true;
    for (const element of audioElements) element.remove(); audioElements.clear();
    $('#call-orb').classList.remove('ringing', 'live'); elements.root.dataset.callState = 'idle'; $('#call-status').textContent = status;
    const button = $('#test-call'); button.disabled = false; button.textContent = 'Call'; button.classList.remove('danger'); button.classList.add('accent');
    const seconds = callStartedAt ? Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)) : 0;
    $('#call-timer').textContent = `${formatTimer(seconds)} · test call · not billed`;
    liveRoom = null;
  }
  function updateTimer() { $('#call-timer').textContent = `${formatTimer(Math.floor((Date.now() - callStartedAt) / 1000))} / ${formatTimer(callMaxSeconds)} · test call · not billed`; }
  function formatTimer(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  function renderTranscript() {
    if (!elements.transcript) return;
    $('#phone-transcript').innerHTML = [...transcriptSegments.values()].sort((a,b) => a.at - b.at).map(item => `<p class="${item.who}"><span>${item.who === 'ai' ? 'AI employee' : 'You'}</span>${escapeHtml(item.text)}</p>`).join('');
    $('#phone-transcript').scrollTop = $('#phone-transcript').scrollHeight;
  }
  function phoneError(code) {
    return ({ phone_service_not_configured:'Voice testing is not available yet. Please try again later.', phone_test_unavailable:'The voice service is temporarily unavailable.', business_not_found:'This AI employee could not be found.', phone_agent_configuration_incomplete:'Finish creating your AI employee before testing its voice.', authentication_required:'Sign in to test your AI employee.' })[code] || 'Could not start the live test call.';
  }
      function showError(message) { elements.error.textContent = message; elements.error.hidden = false; }
      function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
    }
  };
})();
