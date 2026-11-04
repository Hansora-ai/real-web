import crypto from 'node:crypto';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { rows, serviceInsert, supabaseRequest } from './db.mjs';
import { automationPricesFor, canAfford } from './billing.mjs';
import { PHONE_AGENT_NAME, normalizePhoneNumber } from './phone.mjs';
import { outgoingLineFor } from './phone-outgoing.mjs';

export const MAX_CALLS_PER_10_MINUTES = 5;

const failure = code => Object.assign(new Error(code), { code });

// Starts an outgoing AI call (used by "Call now", the inbox button and automatic calls).
// The call is recorded right away as 'ringing', so automatic calls are never started twice;
// the phone worker dials, then marks it connected (billing starts on answer) or missed.
export async function startOutgoingCall({ businessId, to, purpose, contactName = '', triggerKey = '', env = process.env }) {
  const number = normalizePhoneNumber(to);
  if (!/^\+[1-9][0-9]{7,14}$/.test(number)) throw failure('invalid_number');
  const reason = String(purpose || '').trim().slice(0, 500);
  if (!reason) throw failure('purpose_required');
  const numbers = rows(await supabaseRequest(`/rest/v1/automation_phone_numbers?business_id=eq.${encodeURIComponent(businessId)}&status=eq.assigned&select=e164,country,livekit_outbound_trunk_id,allow_international&limit=50`));
  if (!numbers.some(item => item.livekit_outbound_trunk_id)) throw failure('no_outgoing_line');
  const line = outgoingLineFor(numbers, number);
  if (!line) throw failure('other_country');
  const perMinute = (await automationPricesFor(businessId)).voiceMinute;
  if (!(await canAfford(businessId, perMinute)).ok) throw failure('credits_required');
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = rows(await supabaseRequest(`/rest/v1/automation_calls?business_id=eq.${encodeURIComponent(businessId)}&direction=eq.outbound&started_at=gte.${encodeURIComponent(since)}&select=id&limit=${MAX_CALLS_PER_10_MINUTES}`));
  if (recent.length >= MAX_CALLS_PER_10_MINUTES) throw failure('too_many_calls');

  const url = String(env.LIVEKIT_URL || '').trim();
  const apiKey = String(env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env.LIVEKIT_API_SECRET || '').trim();
  if (!url || !apiKey || !apiSecret) throw failure('phone_service_not_configured');
  const room = `hansora-out-${businessId.slice(0, 8)}-${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  await serviceInsert('automation_calls', { business_id: businessId, provider_call_id: `outbound:${room}`, direction: 'outbound', status: 'ringing', started_at: at, billable_seconds: 0, outcome: { called_number: number, line_number: line.e164, purpose: reason, ...(triggerKey ? { trigger_key: triggerKey } : {}) } });
  const metadata = JSON.stringify({ business_id: businessId, direction: 'outbound', to: number, from: line.e164, trunk_id: line.livekit_outbound_trunk_id, purpose: reason, contact_name: String(contactName || '').slice(0, 120), trigger_key: triggerKey || undefined });
  await new AgentDispatchClient(url, apiKey, apiSecret).createDispatch(room, env.LIVEKIT_PHONE_AGENT_NAME || PHONE_AGENT_NAME, { metadata });
  return { calling: number, from: line.e164 };
}
