// The controlled profile is opt-in until real-call acceptance tests pass.
export function phoneTurnPolicy(profile = 'realtime') {
  if (!['realtime', 'controlled'].includes(profile)) throw new Error('phone_turn_profile_invalid');
  if (profile === 'realtime') return {
    profile,
    vadOptions: null,
    turnHandling: { turnDetection: 'realtime_llm' },
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 100, silenceDurationMs: 500 } }
  };
  return {
    profile,
    vadOptions: { minSpeechDuration: 80, minSilenceDuration: 550, prefixPaddingDuration: 500, activationThreshold: 0.6 },
    turnHandling: {
      turnDetection: 'vad',
      endpointing: { minDelay: 550, maxDelay: 1500 },
      interruption: { mode: 'vad', minDuration: 300, falseInterruptionTimeout: 1000, resumeFalseInterruption: true }
    },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } }
  };
}

// With manual Gemini activity, audio before activityStart is not part of the
// utterance. Retain a bounded pre-roll until LiveKit accepts speech, then send
// activityStart BEFORE those original frames. No audio is persisted.
export function createPhoneInputGate({ prefixMs = 500 } = {}) {
  const sessions = new Set();
  let closed = false;
  const counts = { activity_starts: 0, pre_roll_frames: 0, provider_turn_signals_ignored: 0, duplicate_interrupts_ignored: 0 };
  return {
    snapshot() { return { ...counts }; },
    close() { closed = true; for (const state of sessions) state.frames.length = 0; sessions.clear(); },
    instrumentModel(model) {
      const originalSession = model.session.bind(model);
      model.session = (...args) => {
        const session = originalSession(...args);
        const state = { active: false, frames: [], duration: 0 };
        sessions.add(state);
        const push = session.pushAudio.bind(session);
        const start = session.startUserActivity.bind(session);
        const reply = session.generateReply.bind(session);
        const interrupt = session.interrupt.bind(session);
        const emit = session.emit.bind(session);
        session.emit = (event, ...eventArgs) => {
          // Google's plugin uses these signals on generation boundaries even
          // when server VAD is disabled. In this profile local VAD owns speech;
          // treating a model generation as caller speech reopens activity and
          // can trigger phantom input/interruptions. Keep all other events.
          if (event === 'input_speech_started' || event === 'input_speech_stopped') { counts.provider_turn_signals_ignored++; return false; }
          return emit(event, ...eventArgs);
        };
        session.pushAudio = frame => {
          if (closed) return;
          if (state.active) return push(frame);
          const duration = 1000 * (frame.samplesPerChannel ?? frame.data.length / (frame.numChannels || 1)) / frame.sampleRate;
          if (!Number.isFinite(duration) || duration <= 0) return;
          state.frames.push({ frame, duration }); state.duration += duration;
          while (state.frames.length && state.duration > prefixMs) state.duration -= state.frames.shift().duration;
        };
        session.startUserActivity = () => {
          if (closed) return;
          const result = start();
          if (!state.active) {
            counts.activity_starts++;
            state.active = true;
            const frames = state.frames; state.frames = []; state.duration = 0;
            counts.pre_roll_frames += frames.length;
            for (const { frame } of frames) push(frame);
          }
          return result;
        };
        session.generateReply = (...replyArgs) => {
          state.active = false;
          return reply(...replyArgs);
        };
        session.interrupt = (...interruptArgs) => {
          // activityStart has already interrupted Gemini for this utterance.
          // LiveKit can interrupt again when committing that same user turn;
          // by then the plugin may be receiving the next response. Its second
          // interrupt would mark that response for discarding until completion.
          if (state.active) { counts.duplicate_interrupts_ignored++; return Promise.resolve(); }
          return interrupt(...interruptArgs);
        };
        return session;
      };
      return model;
    }
  };
}
