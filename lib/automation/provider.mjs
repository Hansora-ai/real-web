import { fixMixedScript } from './script-guard.mjs';
import { askElevenLabsText, buildElevenLabsAgentConfig, syncElevenLabsAgent } from './providers/elevenlabs.mjs';

export function automationProviderName() {
  return String(process.env.HANSORA_AUTOMATION_PROVIDER || 'elevenlabs').trim().toLowerCase();
}

// A clock time in a reply ("17:00") means the AI is talking about availability.
const MENTIONS_TIME = /(^|[^\d])([01]?\d|2[0-3]):[0-5]\d(?!\d)/;
const CHECKING_TOOLS = new Set(['check_availability', 'create_booking', 'cancel_booking', 'check_delivery_times', 'create_order']);
export function needsTimeCheck(reply) {
  return !(reply?.toolCalls || []).some(call => CHECKING_TOOLS.has(call.name)) && MENTIONS_TIME.test(String(reply?.text || ''));
}
export const TIME_CHECK_NOTE = '[Booking system note, not from the customer: your answer mentioned a time without checking. Call check_availability now for the day and time being discussed (pass places_count if the customer wants more than one place), or check_delivery_times for deliveries, and answer only from that result.]';

// checkTimes: for businesses with bookings or delivery times. If the reply names a time but the AI did not check
// in this turn, it is not sent: the AI answers again and must check first. A guard in code, because small models
// sometimes answer from memory even when told to check.
export async function generateAutomationReply({ providerResourceId, text, context, channel, onToolCall, checkTimes = false, fetchImpl, WebSocketImpl }) {
  const provider = automationProviderName();
  if (provider === 'elevenlabs') {
    const ask = message => askElevenLabsText({ agentId: providerResourceId, text: message, context, channel, onToolCall, fetchImpl, WebSocketImpl });
    let reply = await ask(text);
    if (checkTimes && needsTimeCheck(reply)) {
      console.log('automation reply named a time without checking; asking again', { channel });
      const again = await ask(`${text}\n\n${TIME_CHECK_NOTE}`);
      reply = { ...again, toolCalls: [...(reply.toolCalls || []), ...(again.toolCalls || [])], rechecked: true };
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
