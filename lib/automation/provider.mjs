import { fixMixedScript } from './script-guard.mjs';
import { askElevenLabsText, buildElevenLabsAgentConfig, syncElevenLabsAgent } from './providers/elevenlabs.mjs';

export function automationProviderName() {
  return String(process.env.HANSORA_AUTOMATION_PROVIDER || 'elevenlabs').trim().toLowerCase();
}

// Clock times named in a reply ("17:00").
const TIMES_IN_TEXT = /(^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g;
const CHECKING_TOOLS = new Set(['check_availability', 'create_booking', 'cancel_booking', 'check_delivery_times', 'create_order']);
export const TIME_CHECK_NOTE = '[Booking system note, not from the customer: your answer named a time that is not free according to the live availability. Call check_availability now for the day and time being discussed (pass places_count if the customer wants more than one place), and answer only from that result.]';

// knownTimes: times that are really free right now plus opening/closing hours (from the live availability sent
// with the message). A reply naming only those is fine; any other time, without a check in this turn, is not.
export function needsTimeCheck(reply, knownTimes = null) {
  if ((reply?.toolCalls || []).some(call => CHECKING_TOOLS.has(call.name))) return false;
  const times = [...String(reply?.text || '').matchAll(TIMES_IN_TEXT)].map(match => `${match[2].padStart(2, '0')}:${match[3]}`);
  if (!times.length) return false;
  if (!Array.isArray(knownTimes)) return true;
  const known = new Set(knownTimes);
  return times.some(time => !known.has(time));
}

// checkTimes: for businesses with bookings. A reply that names a time which is not free, without checking in this
// turn, is not sent: the AI answers again and must check first (small models sometimes answer from memory).
// A dropped ElevenLabs connection is retried once, and a failed second attempt never loses the first answer.
export async function generateAutomationReply({ providerResourceId, text, context, channel, onToolCall, checkTimes = false, knownTimes = null, fetchImpl, WebSocketImpl }) {
  const provider = automationProviderName();
  if (provider === 'elevenlabs') {
    const once = message => askElevenLabsText({ agentId: providerResourceId, text: message, context, channel, onToolCall, fetchImpl, WebSocketImpl });
    const ask = async message => {
      try { return await once(message); }
      catch (error) {
        if (error?.message !== 'elevenlabs_websocket_closed') throw error;
        console.warn('automation AI connection dropped; trying once more', { channel });
        return once(message);
      }
    };
    let reply = await ask(text);
    if (checkTimes && needsTimeCheck(reply, knownTimes)) {
      console.log('automation reply named a time that is not free without checking; asking again', { channel });
      try {
        const again = await ask(`${text}\n\n${TIME_CHECK_NOTE}`);
        reply = { ...again, toolCalls: [...(reply.toolCalls || []), ...(again.toolCalls || [])], rechecked: true };
      } catch (error) { console.warn('automation recheck failed; sending the first answer', { channel, message: error?.message }); }
    }
    return { ...reply, text: fixMixedScript(reply.text) };
  }
  const error = new Error('automation_provider_not_supported'); error.status = 503; throw error;
}

export async function synchronizeAutomationAgent(input) {
  const provider = automationProviderName();
  if (provider === 'elevenlabs') {
    const config = buildElevenLabsAgentConfig(input);
    return syncElevenLabsAgent({ providerResourceId: input.providerResourceId, config, tools: input.tools, existingToolIds: input.existingToolIds, fetchImpl: input.fetchImpl });
  }
  const error = new Error('automation_provider_not_supported');
  error.status = 503;
  throw error;
}
