export const PHONE_AGENT_NAME = 'hansora-phone-agent';
export const PHONE_MODEL = 'gemini-3.8-live';
export const PHONE_VOICE = 'Laomedeia';

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
  const participant = parsePhoneMetadata(participantMetadata);
  const businessId = String(job.business_id || participant.business_id || attributes['hansora.businessId'] || '');
  const direction = job.direction === 'test' || participant.direction === 'test' || attributes['hansora.callDirection'] === 'test' ? 'test' : 'inbound';
  const callerNumber = direction === 'test' ? '' : normalizePhoneNumber(attributes['sip.phoneNumber']);
  const calledNumber = direction === 'test' ? '' : normalizePhoneNumber(attributes['sip.trunkPhoneNumber']);
  const providerCallId = String(attributes['sip.callID'] || attributes['sip.callIDFull'] || roomName || participantIdentity).slice(0, 500);
  return {
    businessId: UUID.test(businessId) ? businessId : '',
    ownerUserId: String(job.owner_user_id || participant.owner_user_id || '').slice(0, 200),
    direction,
    callerNumber,
    calledNumber,
    providerCallId,
    roomName: String(roomName || '').slice(0, 500),
    participantIdentity: String(participantIdentity || '').slice(0, 500)
  };
}

export function voiceInstructions(baseInstructions, actionInstructions, settings = {}) {
  const greeting = String(settings.greeting || '').trim().slice(0, 300);
  return [
    baseInstructions,
    actionInstructions,
    '## Phone conversation rules',
    'This is a live phone call. Speak naturally in plain text, with short sentences and one question at a time.',
    'Do not use markdown, lists, emoji, links, or internal tool names. Read dates, times, prices, phone numbers, and reference numbers clearly.',
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
