import crypto from 'node:crypto';
import { RoomAgentDispatch, RoomConfiguration, SipClient } from 'livekit-server-sdk';
import { PHONE_AGENT_NAME } from './phone.mjs';

// "Bring your own SIP number": the owner's provider sends calls to Hansora's LiveKit SIP address and
// signs in with a username/password made for that business. Each business gets its own LiveKit
// inbound trunk (its numbers + its credentials) and a dispatch rule that sends the calls to the
// phone agent, exactly like calls to Hansora's own numbers (the worker finds the business by number).

export function sipClient(env = process.env) {
  return new SipClient(String(env.LIVEKIT_URL || '').trim().replace(/^wss:/, 'https:'), String(env.LIVEKIT_API_KEY || '').trim(), String(env.LIVEKIT_API_SECRET || '').trim());
}

// Where providers send calls, e.g. sip:5x8zfd6diop.sip.livekit.cloud
export function sipAddress(env = process.env) {
  const host = String(env.LIVEKIT_SIP_HOST || '5x8zfd6diop.sip.livekit.cloud').trim();
  return `sip:${host.replace(/^sip:/, '')}`;
}

// Providers write the called number with or without "+", so the trunk lists both.
export function trunkNumbers(e164List) {
  return [...new Set(e164List.flatMap(e164 => [e164, e164.replace(/^\+/, '')]))];
}

export function newSipCredentials() {
  return { username: `hansora${crypto.randomBytes(5).toString('hex')}`, password: crypto.randomBytes(18).toString('base64url') };
}

// Creates the business's trunk and dispatch rule. Returns their ids.
export async function createImportTrunk({ businessId, numbers, username, password, client = sipClient() }) {
  const trunk = await client.createSipInboundTrunk(`hansora-import-${businessId.slice(0, 8)}`, trunkNumbers(numbers), { authUsername: username, authPassword: password, metadata: JSON.stringify({ business_id: businessId, source: 'sip_import' }) });
  try {
    const rule = await client.createSipDispatchRule({ type: 'individual', roomPrefix: 'hansora-call-' }, {
      name: `Imported SIP ${businessId.slice(0, 8)}`,
      trunkIds: [trunk.sipTrunkId],
      roomConfig: new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: PHONE_AGENT_NAME, metadata: JSON.stringify({ direction: 'inbound' }) })] })
    });
    return { trunkId: trunk.sipTrunkId, ruleId: rule.sipDispatchRuleId };
  } catch (error) {
    await client.deleteSipTrunk(trunk.sipTrunkId).catch(() => null);
    throw error;
  }
}

// Replaces the trunk's number list (e.g. after adding or removing one).
export async function setTrunkNumbers({ trunkId, numbers, client = sipClient() }) {
  const trunk = (await client.listSipInboundTrunk()).find(item => item.sipTrunkId === trunkId);
  if (!trunk) throw new Error('livekit_trunk_not_found');
  trunk.numbers = trunkNumbers(numbers);
  await client.updateSipInboundTrunk(trunkId, trunk);
}

export async function deleteImportTrunk({ trunkId, ruleId, client = sipClient() }) {
  if (ruleId) await client.deleteSipDispatchRule(ruleId).catch(error => console.warn('sip import: dispatch rule delete failed', { message: error?.message }));
  if (trunkId) await client.deleteSipTrunk(trunkId).catch(error => console.warn('sip import: trunk delete failed', { message: error?.message }));
}
