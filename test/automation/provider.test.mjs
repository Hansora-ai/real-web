import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutomationInstructions, firstMessageFor } from '../../lib/automation/instructions.mjs';
import { buildElevenLabsAgentConfig, syncElevenLabsAgent } from '../../lib/automation/providers/elevenlabs.mjs';

const input = {
  business: { id: '11111111-1111-4111-8111-111111111111', name: 'Ararat Studio', description: 'Custom interiors' },
  agent: { display_name: 'Ararat Assistant', primary_language: 'hy', supported_languages: ['hy','ru','en'], tone: 'friendly', custom_instructions: 'Be concise.', prohibited_instructions: 'Never invent prices.' },
  knowledge: { services_and_prices: 'Measurement — 10,000 AMD', opening_hours: 'Mon–Sat 10:00–19:00', delivery_and_service_areas: 'Yerevan', frequently_asked_questions: 'Warranty: 12 months', policies: 'Confirm dates.' }
};

test('instructions contain business facts and safety rules', () => {
  const result = buildAutomationInstructions(input);
  assert.match(result, /Measurement — 10,000 AMD/);
  assert.match(result, /Never invent a price/);
  assert.match(result, /Armenian, Russian, English/);
  assert.match(firstMessageFor(input), /Ararat Studio/);
});

test('ElevenLabs config is a private text agent payload', () => {
  const instructions = buildAutomationInstructions(input);
  const result = buildElevenLabsAgentConfig({ ...input, instructions, firstMessage: firstMessageFor(input) });
  assert.equal(result.conversation_config.conversation.text_only, true);
  assert.equal(result.conversation_config.agent.language, 'hy');
  assert.match(result.conversation_config.agent.prompt.prompt, /Never invent/);
  assert.deepEqual(result.tags, ['hansora-automation', `business:${input.business.id}`]);
});

test('provider creates a new agent and returns only its stable id', async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ agent_id: 'agent_test_123' }) };
  };
  try {
    const result = await syncElevenLabsAgent({ config: { name: 'Test' }, fetchImpl });
    assert.equal(request.url, 'https://api.elevenlabs.io/v1/convai/agents/create');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['xi-api-key'], 'test-key');
    assert.deepEqual(result, { provider: 'elevenlabs', resourceId: 'agent_test_123', created: true, raw: { agent_id: 'agent_test_123' } });
  } finally {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});
