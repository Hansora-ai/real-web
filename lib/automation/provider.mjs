import { askElevenLabsText, buildElevenLabsAgentConfig, syncElevenLabsAgent } from './providers/elevenlabs.mjs';

export function automationProviderName() {
  return String(process.env.HANSORA_AUTOMATION_PROVIDER || 'elevenlabs').trim().toLowerCase();
}

export async function generateAutomationReply({ providerResourceId, text, context, channel, onToolCall, fetchImpl, WebSocketImpl }) {
  const provider = automationProviderName();
  if (provider === 'elevenlabs') return askElevenLabsText({ agentId: providerResourceId, text, context, channel, onToolCall, fetchImpl, WebSocketImpl });
  const error = new Error('automation_provider_not_supported'); error.status = 503; throw error;
}

export async function synchronizeAutomationAgent(input) {
  const provider = automationProviderName();
  if (provider === 'elevenlabs') {
    const config = buildElevenLabsAgentConfig(input);
    return syncElevenLabsAgent({ providerResourceId: input.providerResourceId, config, fetchImpl: input.fetchImpl });
  }
  const error = new Error('automation_provider_not_supported');
  error.status = 503;
  throw error;
}
