import { SipClient } from 'livekit-server-sdk';

// Buys a local voice number from Telnyx and attaches it to the SIP connection
// that sends calls to LiveKit; the LiveKit inbound trunk then has to list the
// number too. Off unless TELNYX_API_KEY, TELNYX_CONNECTION_ID and
// LIVEKIT_TELNYX_TRUNK_ID are set. Numbers stay in Hansora's pool after a
// business releases them, so each number is bought once.
const API = 'https://api.telnyx.com/v2';

export function telnyxConfigured(env = process.env) {
  return ['TELNYX_API_KEY', 'TELNYX_CONNECTION_ID', 'LIVEKIT_TELNYX_TRUNK_ID'].every(name => String(env[name] || '').trim());
}

// LiveKit accepts calls on a trunk only for the numbers it lists. Each number
// provider has its own LiveKit inbound trunk (Telnyx by default).
export async function acceptOnLiveKitTrunk(e164, { env = process.env, client, trunkId = String(env.LIVEKIT_TELNYX_TRUNK_ID || '').trim() } = {}) {
  const sip = client || new SipClient(String(env.LIVEKIT_URL || '').trim().replace(/^wss:/, 'https:'), String(env.LIVEKIT_API_KEY || '').trim(), String(env.LIVEKIT_API_SECRET || '').trim());
  const trunk = (await sip.listSipInboundTrunk()).find(item => item.sipTrunkId === trunkId);
  if (!trunk) throw new Error('livekit_trunk_not_found');
  if (trunk.numbers.includes(e164)) return;
  trunk.numbers = [...trunk.numbers, e164];
  await sip.updateSipInboundTrunk(trunkId, trunk);
}

async function telnyx(path, { method = 'GET', body, env = process.env, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${String(env.TELNYX_API_KEY).trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || `telnyx_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally { clearTimeout(timer); }
}

// Returns { e164, providerNumberId } for a number Telnyx accepted, or null when
// the country has no number to buy without extra paperwork.
export async function buyTelnyxNumber(country, { env = process.env, fetchImpl = fetch } = {}) {
  const code = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const query = new URLSearchParams({ 'filter[country_code]': code, 'filter[features][]': 'voice', 'filter[limit]': '5' });
  const found = await telnyx(`/available_phone_numbers?${query}`, { env, fetchImpl });
  const candidates = (found?.data || []).filter(item => /^\+[1-9][0-9]{7,14}$/.test(item?.phone_number || ''));
  // Countries that need identity or address documents first are left for a manual order.
  const candidate = candidates.find(item => !(item.regulatory_requirements || []).length);
  if (!candidate) return null;
  const order = await telnyx('/number_orders', {
    method: 'POST',
    body: { phone_numbers: [{ phone_number: candidate.phone_number }], connection_id: String(env.TELNYX_CONNECTION_ID).trim(), customer_reference: 'hansora-phone-pool' },
    env, fetchImpl
  });
  if (!order?.data?.id) return null;
  return { e164: candidate.phone_number, providerNumberId: order.data.id };
}
