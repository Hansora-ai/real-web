// Buys a local voice number from Twilio and attaches it to the Elastic SIP
// trunk whose origination URI is the LiveKit SIP endpoint. Off unless
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_TRUNK_SID and
// LIVEKIT_TWILIO_TRUNK_ID are set.
const API = 'https://api.twilio.com/2010-04-01';

export function twilioConfigured(env = process.env) {
  return ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_TRUNK_SID', 'LIVEKIT_TWILIO_TRUNK_ID'].every(name => String(env[name] || '').trim());
}

async function twilio(path, { method = 'GET', form, env = process.env, fetchImpl = fetch } = {}) {
  const sid = String(env.TWILIO_ACCOUNT_SID).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(`${API}/Accounts/${encodeURIComponent(sid)}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${String(env.TWILIO_AUTH_TOKEN).trim()}`).toString('base64')}`, Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || `twilio_${response.status}`);
      error.status = response.status;
      error.code = payload?.code;
      throw error;
    }
    return payload;
  } finally { clearTimeout(timer); }
}

// Returns { e164, providerNumberId } or null when the country has no local
// voice number that can be bought without an address or regulatory bundle.
export async function buyTwilioNumber(country, { env = process.env, fetchImpl = fetch } = {}) {
  const code = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const query = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '5' });
  const found = await twilio(`/AvailablePhoneNumbers/${code}/Local.json?${query}`, { env, fetchImpl }).catch(error => { if (error.status === 404) return null; throw error; });
  // Countries that need an address or identity documents are left for a manual order.
  const candidates = (found?.available_phone_numbers || []).filter(item => /^\+[1-9][0-9]{7,14}$/.test(item?.phone_number || '') && (!item.address_requirements || item.address_requirements === 'none'));
  let refused = null;
  for (const candidate of candidates.slice(0, 2)) {
    try {
      const bought = await twilio('/IncomingPhoneNumbers.json', { method: 'POST', form: { PhoneNumber: candidate.phone_number, TrunkSid: String(env.TWILIO_TRUNK_SID).trim(), FriendlyName: 'Hansora phone pool' }, env, fetchImpl });
      if (bought?.sid) return { e164: bought.phone_number || candidate.phone_number, providerNumberId: bought.sid };
    } catch (error) {
      // Taken by someone else in the meantime, or a regulatory requirement: try the next one once.
      if (error.status !== 400) throw error;
      refused = error;
    }
  }
  // Both tries refused: pass on Twilio's reason (often an account or compliance issue) instead of hiding it.
  if (refused) throw refused;
  return null;
}
