// WhatsApp calls answered by the AI employee, over SIP (Meta's WhatsApp Business Calling, user-initiated calls).
//
// Turning it on for a connected WhatsApp number:
//   1. Meta: calling ENABLED on the number, SIP ENABLED with Hansora's LiveKit SIP address (TLS, port 5061) and SRTP
//      keys exchanged in the SDP (SDES), so no ICE/DTLS is needed.
//   2. Meta generates a SIP password for that number; Meta signs in with the number (digits, no "+") and that password.
//   3. LiveKit: an inbound trunk for exactly that number and those credentials (encrypted media required), and a
//      dispatch rule that sends its calls to the phone agent with the business id, like the business's phone calls.
// Turning it off: SIP and calling DISABLED at Meta, the trunk and rule removed.
// Meta answers with its own error when the number cannot have calls (for example a messaging limit under 2,000, or a
// number also used in the WhatsApp Business app): that message is shown to the owner as it is.
import { RoomAgentDispatch, RoomConfiguration, SipClient } from 'livekit-server-sdk';
import { PHONE_AGENT_NAME } from './phone.mjs';

const TIMEOUT_MS = 20000;
const SIP_TLS_PORT = 5061;
const MEDIA_ENCRYPT_REQUIRE = 2; // LiveKit SIPMediaEncryption.SIP_MEDIA_ENCRYPT_REQUIRE

export function sipHost(env = process.env) {
  return String(env.LIVEKIT_SIP_HOST || '5x8zfd6diop.sip.livekit.cloud').trim().replace(/^sips?:/, '').replace(/:\d+$/, '');
}

export function livekitSip(env = process.env) {
  return new SipClient(String(env.LIVEKIT_URL || '').trim().replace(/^wss:/, 'https:'), String(env.LIVEKIT_API_KEY || '').trim(), String(env.LIVEKIT_API_SECRET || '').trim());
}

// "+374 91 918868" → { e164: "+37491918868", digits: "37491918868" }
export function businessNumber(display) {
  const digits = String(display || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw Object.assign(new Error('whatsapp_number_unknown'), { status: 409 });
  return { e164: `+${digits}`, digits };
}

// A Graph API error, kept readable for the owner: Meta's own message and code.
export class MetaCallingError extends Error {
  constructor(step, status, error = {}) {
    super(`whatsapp_calling_${step}_failed`);
    this.status = 409;
    this.step = step;
    this.providerStatus = status;
    this.metaCode = error.code ?? null;
    this.metaSubcode = error.error_subcode ?? null;
    this.metaMessage = String(error.error_user_msg || error.message || '').slice(0, 500);
    this.metaDetails = String(error.error_data?.details || error.error_user_title || '').slice(0, 500);
  }
}

async function graph({ path, method = 'GET', body, accessToken, graphVersion, step, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new MetaCallingError(step, response.status, data?.error || {});
  return data;
}

export function enableBody(host = sipHost()) {
  return {
    calling: {
      status: 'ENABLED',
      call_icon_visibility: 'DEFAULT',
      srtp_key_exchange_protocol: 'SDES',
      sip: { status: 'ENABLED', servers: [{ hostname: host, port: SIP_TLS_PORT }] }
    }
  };
}

export const DISABLE_BODY = { calling: { status: 'DISABLED', sip: { status: 'DISABLED' } } };

// Meta's SIP password for this number and app (only returned with include_sip_credentials).
export function sipPasswordFrom(settings) {
  const servers = settings?.calling?.sip?.servers;
  const password = Array.isArray(servers) ? servers.map(server => server?.sip_user_password).find(Boolean) : null;
  if (!password) throw Object.assign(new Error('whatsapp_sip_password_missing'), { status: 502 });
  return String(password);
}

export async function enableWhatsAppCalls({ businessId, phoneNumberId, displayNumber, accessToken, graphVersion, host = sipHost(), sip = livekitSip(), fetchImpl = fetch }) {
  const number = businessNumber(displayNumber);
  const id = encodeURIComponent(phoneNumberId);
  await graph({ path: `${id}/settings`, method: 'POST', body: enableBody(host), accessToken, graphVersion, step: 'enable', fetchImpl });
  const settings = await graph({ path: `${id}/settings?include_sip_credentials=true`, accessToken, graphVersion, step: 'credentials', fetchImpl });
  const password = sipPasswordFrom(settings);
  // Meta writes the called number with "+"; the trunk also accepts it without.
  const trunk = await sip.createSipInboundTrunk(`hansora-whatsapp-${businessId.slice(0, 8)}`, [number.e164, number.digits], {
    authUsername: number.digits,
    authPassword: password,
    mediaEncryption: MEDIA_ENCRYPT_REQUIRE,
    metadata: JSON.stringify({ business_id: businessId, source: 'whatsapp' })
  });
  try {
    const rule = await sip.createSipDispatchRule({ type: 'individual', roomPrefix: 'hansora-wa-call-' }, {
      name: `WhatsApp calls ${businessId.slice(0, 8)}`,
      trunkIds: [trunk.sipTrunkId],
      // The business comes from this server-made dispatch, not from the caller (see describePhoneCall).
      roomConfig: new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: PHONE_AGENT_NAME, metadata: JSON.stringify({ direction: 'inbound', business_id: businessId, channel: 'whatsapp' }) })] })
    });
    return { e164: number.e164, trunkId: trunk.sipTrunkId, ruleId: rule.sipDispatchRuleId, sipStatus: settings?.calling?.sip?.status || null, callingStatus: settings?.calling?.status || null };
  } catch (error) {
    await sip.deleteSipTrunk(trunk.sipTrunkId).catch(() => null);
    throw error;
  }
}

export async function disableWhatsAppCalls({ phoneNumberId, accessToken, graphVersion, trunkId, ruleId, sip = livekitSip(), fetchImpl = fetch }) {
  let metaError = null;
  if (phoneNumberId && accessToken) {
    await graph({ path: `${encodeURIComponent(phoneNumberId)}/settings`, method: 'POST', body: DISABLE_BODY, accessToken, graphVersion, step: 'disable', fetchImpl }).catch(error => { metaError = error; });
  }
  if (ruleId) await sip.deleteSipDispatchRule(ruleId).catch(error => console.warn('whatsapp calls: dispatch rule delete failed', { message: error?.message }));
  if (trunkId) await sip.deleteSipTrunk(trunkId).catch(error => console.warn('whatsapp calls: trunk delete failed', { message: error?.message }));
  return { metaError };
}

// What the owner sees when Meta refuses: Meta's words, plus a hint for the reasons seen most.
export function explainMetaError(error) {
  if (!(error instanceof MetaCallingError)) return null;
  const text = `${error.metaMessage} ${error.metaDetails}`.toLowerCase();
  const hint = /coexist|business app|whatsapp business app/.test(text)
    ? 'This number is also used in the WhatsApp Business app. Meta allows calls through Hansora only on a number used through the API alone.'
    : /messaging limit|tier|2,?000/.test(text)
      ? 'Meta allows calls only on numbers with a messaging limit of 2,000 or more. This usually needs Meta Business Verification.'
      : /permission|not authorized|access/.test(text)
        ? 'Meta did not allow Hansora to change this number’s call settings. Reconnecting WhatsApp on the Channels page usually fixes it.'
        : '';
  return { step: error.step, meta_code: error.metaCode, meta_subcode: error.metaSubcode, meta_message: error.metaMessage, meta_details: error.metaDetails, hint };
}
