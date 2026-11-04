export const PHONE_AGENT_NAME = 'hansora-phone-agent';
export const PHONE_MODEL = 'gemini-3.8-live';
export const PHONE_VOICE = 'Leda';

// Gemini's prebuilt voices (the same names work for Live calls and for the preview clips).
export const PHONE_VOICES = [
  ['Leda', 'female', 'Youthful'], ['Callirrhoe', 'female', 'Easy-going'], ['Schedar', 'male', 'Even'], ['Sadachbia', 'male', 'Lively'],
  ['Zephyr', 'female', 'Bright'], ['Kore', 'female', 'Firm'], ['Aoede', 'female', 'Breezy'], ['Autonoe', 'female', 'Bright'],
  ['Despina', 'female', 'Smooth'], ['Erinome', 'female', 'Clear'], ['Laomedeia', 'female', 'Upbeat'], ['Achernar', 'female', 'Soft'],
  ['Gacrux', 'female', 'Mature'], ['Pulcherrima', 'female', 'Forward'], ['Vindemiatrix', 'female', 'Gentle'], ['Sulafat', 'female', 'Warm'],
  ['Puck', 'male', 'Upbeat'], ['Charon', 'male', 'Informative'], ['Fenrir', 'male', 'Excitable'], ['Orus', 'male', 'Firm'],
  ['Enceladus', 'male', 'Breathy'], ['Iapetus', 'male', 'Clear'], ['Umbriel', 'male', 'Easy-going'], ['Algieba', 'male', 'Smooth'],
  ['Algenib', 'male', 'Gravelly'], ['Rasalgethi', 'male', 'Informative'], ['Alnilam', 'male', 'Firm'], ['Achird', 'male', 'Friendly'],
  ['Zubenelgenubi', 'male', 'Casual'], ['Sadaltager', 'male', 'Knowledgeable']
].map(([name, gender, style]) => ({ name, gender, style }));
export const PHONE_RECOMMENDED_VOICES = ['Leda', 'Callirrhoe', 'Schedar', 'Sadachbia'];

// The voice name exactly as Gemini knows it, or '' when it is not one of the prebuilt voices.
export function phoneVoice(value) {
  const wanted = String(value || '').trim().toLowerCase();
  return PHONE_VOICES.find(voice => voice.name.toLowerCase() === wanted)?.name || '';
}

export function phoneTestMaxSeconds() {
  const value = Number(process.env.AUTOMATION_PHONE_TEST_MAX_SECONDS || 300);
  return Number.isFinite(value) ? Math.min(600, Math.max(30, Math.floor(value))) : 300;
}

export function phoneTestSettings(value = {}) {
  const voice = phoneVoice(value?.voice);
  return { greeting: String(value?.greeting || '').trim().slice(0, 300), save_transcripts: value?.save_transcripts !== false, ...phoneLanguageSettings(value), ...(voice ? { voice } : {}) };
}

// The owner's language choice for calls: 'auto' (the caller's language) or 'only' a chosen list.
export function phoneLanguageSettings(value = {}) {
  const languages = Array.isArray(value?.languages) ? [...new Set(value.languages.map(code => String(code).toLowerCase()).filter(code => /^[a-z]{2}$/.test(code)))].slice(0, 8) : [];
  return value?.language_mode === 'only' && languages.length ? { language_mode: 'only', languages } : { language_mode: 'auto' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

export function parsePhoneMetadata(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function describePhoneCall({ jobMetadata, participantMetadata, attributes = {}, roomName = '', participantIdentity = '' } = {}) {
  const job = parsePhoneMetadata(jobMetadata);
  // Only the server's agent dispatch can choose a business or make a call free.
  // Participant metadata/attributes are not an authorization boundary.
  const businessId = String(job.business_id || '');
  const direction = ['test', 'outbound'].includes(job.direction) ? job.direction : 'inbound';
  // On an outgoing call the "caller" side is the person the AI called, and the line is the business's number.
  const callerNumber = direction === 'test' ? '' : direction === 'outbound' ? normalizePhoneNumber(job.to) : normalizePhoneNumber(attributes['sip.phoneNumber']);
  const calledNumber = direction === 'test' ? '' : direction === 'outbound' ? normalizePhoneNumber(job.from) : normalizePhoneNumber(attributes['sip.trunkPhoneNumber']);
  // An outgoing call is already recorded under its room (as 'ringing') by the server that started it.
  const providerCallId = String(direction === 'outbound' && roomName ? `outbound:${roomName}` : attributes['sip.callID'] || attributes['sip.callIDFull'] || roomName || participantIdentity).slice(0, 500);
  return {
    businessId: UUID.test(businessId) ? businessId : '',
    ownerUserId: String(job.owner_user_id || '').slice(0, 200),
    direction,
    purpose: direction === 'outbound' ? String(job.purpose || '').trim().slice(0, 500) : '',
    callerNumber,
    calledNumber,
    providerCallId,
    roomName: String(roomName || '').slice(0, 500),
    participantIdentity: String(participantIdentity || '').slice(0, 500)
  };
}

// Provider-reported usage, separate from the customer's credit bill. A model's
// first-token time measures generation, not the caller's complete audio delay.
export function createPhoneMetrics() {
  const seen = new Set();
  const totals = { responses: 0, input_tokens: 0, output_tokens: 0, input_audio_tokens: 0, input_text_tokens: 0, output_audio_tokens: 0, output_text_tokens: 0, reasoning_tokens: 0, model_first_audio_token_ms: [] };
  return {
    collect(metric) {
      if (metric?.type !== 'realtime_model_metrics') return;
      const key = metric.requestId;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
      totals.responses++;
      totals.input_tokens += count(metric.inputTokens);
      totals.output_tokens += count(metric.outputTokens);
      totals.input_audio_tokens += count(metric.inputTokenDetails?.audioTokens);
      totals.input_text_tokens += count(metric.inputTokenDetails?.textTokens);
      totals.output_audio_tokens += count(metric.outputTokenDetails?.audioTokens);
      totals.output_text_tokens += count(metric.outputTokenDetails?.textTokens);
      // Keep this separately; reasoning is already part of output_tokens.
      totals.reasoning_tokens += count(metric.reasoningTokens);
      if (Number.isFinite(metric.ttftMs) && metric.ttftMs >= 0) totals.model_first_audio_token_ms.push(metric.ttftMs);
    },
    snapshot() { return { ...totals, model_first_audio_token_ms: [...totals.model_first_audio_token_ms] }; }
  };
}

export function voiceInstructions(baseInstructions, actionInstructions, settings = {}) {
  const greeting = String(settings.greeting || '').trim().slice(0, 300);
  return [
    baseInstructions,
    actionInstructions,
    '## Phone conversation rules',
    'This is a live phone call. Speak naturally in plain text, with short sentences and one question at a time.',
    'Do not use markdown, lists, emoji, links, or internal tool names. Read dates, times, prices, phone numbers, and reference numbers clearly. Say a currency as its spoken word in the caller\'s language (for example "dram", not "AMD").',
    'Do not claim that an action succeeded until its tool returns success. If audio is unclear, ask the caller to repeat it.',
    'When the caller asks for a person, tell them you will transfer the call, then call handoff_to_human. If transfer fails, explain that the team will call back.',
    greeting ? `The configured opening sentence is: ${greeting}` : ''
  ].filter(Boolean).join('\n\n');
}

export function billableVoiceSeconds(startedAt, endedAt, connectedAt = startedAt) {
  const start = Date.parse(connectedAt || startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.ceil((end - start) / 1000);
}

export function renderCallTranscript(turns = []) {
  return turns
    .filter(turn => turn && String(turn.text || '').trim())
    .map(turn => `${turn.role === 'assistant' ? 'AI' : 'Caller'}: ${String(turn.text).trim()}`)
    .join('\n')
    .slice(0, 100000);
}
