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
  assert.equal(result.conversation_config.agent.language, 'en'); // reply language comes from the prompt
  assert.equal('tools' in result.conversation_config.agent.prompt, false);
  assert.match(result.conversation_config.agent.prompt.prompt, /Never invent/);
  assert.deepEqual(result.tags, ['hansora-automation', `business:${input.business.id}`]);
  assert.equal(result.conversation_config.agent.prompt.llm, process.env.ELEVENLABS_AGENT_LLM || 'gemini-3.5-flash-lite');
  assert.equal(result.platform_settings.guardrails.prompt_injection.is_enabled, true);
});

test('provider creates a new agent and returns only its stable id', async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key';
  let request;
  const fetchImpl = async (url, options) => {
    // After creating, the agent is read once to add the "reply finished" event (the create call is checked here).
    if (!request || options?.method === 'POST') request = { url, options };
    return { ok: true, status: 200, json: async () => ({ agent_id: 'agent_test_123' }) };
  };
  try {
    const config = { name: 'Test', conversation_config: { agent: { prompt: {} } } };
    const result = await syncElevenLabsAgent({ config, fetchImpl });
    assert.equal(request.url, 'https://api.elevenlabs.io/v1/convai/agents/create');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['xi-api-key'], 'test-key');
    assert.deepEqual(result, { provider: 'elevenlabs', resourceId: 'agent_test_123', created: true, toolIds: {}, raw: { agent_id: 'agent_test_123' } });
  } finally {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});

test('tools are separate ElevenLabs resources: created once, updated later, recreated if deleted', async () => {
  process.env.ELEVENLABS_API_KEY ||= 'test-key';
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(`${options.method || 'GET'} ${url.replace('https://api.elevenlabs.io/v1/convai', '')}`);
    if (url.endsWith('/tools/gone')) return { ok: false, status: 404, json: async () => ({ detail: 'not found' }) };
    if (url.endsWith('/tools')) return { ok: true, status: 200, json: async () => ({ id: `tool_${calls.length}` }) };
    if (url.endsWith('/agents/old')) return { ok: false, status: 404, json: async () => ({ detail: 'agent not found' }) };
    return { ok: true, status: 200, json: async () => ({ agent_id: 'agent_new' }) };
  };
  const tools = [{ name: 'create_lead', description: 'Save a lead', parameters: { type: 'object', properties: {} } }, { name: 'handoff', description: 'Hand over', parameters: { type: 'object', properties: {} } }];
  const config = { conversation_config: { agent: { prompt: {} } } };
  const result = await syncElevenLabsAgent({ providerResourceId: 'old', config, tools, existingToolIds: { create_lead: 'kept', handoff: 'gone' }, fetchImpl });
  assert.deepEqual(calls, ['PATCH /tools/kept', 'PATCH /tools/gone', 'POST /tools', 'PATCH /agents/old', 'POST /agents/create', 'GET /agents/agent_new']);
  assert.deepEqual(config.conversation_config.agent.prompt.tool_ids, ['kept', 'tool_3']);
  assert.equal(result.resourceId, 'agent_new');
  assert.equal(result.created, true);
});

test('ElevenLabs errors keep the provider reason for the owner', async () => {
  process.env.ELEVENLABS_API_KEY ||= 'test-key';
  const fetchImpl = async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'x'], msg: 'bad value' }] }) });
  await assert.rejects(syncElevenLabsAgent({ config: { conversation_config: { agent: { prompt: {} } } }, fetchImpl }), error => error.providerStatus === 422 && /bad value/.test(error.providerMessage));
});

test('language rules: owner-chosen languages, native alphabet, one language means only that one', () => {
  const several = buildAutomationInstructions(input);
  assert.match(several, /one of: Armenian, Russian, English\. If the customer writes in any other language, reply in Armenian\./);
  assert.match(several, /Recognize the language from the words, not from the alphabet/);
  assert.match(several, /Armenian in Armenian letters/);
  const only = buildAutomationInstructions({ ...input, agent: { ...input.agent, supported_languages: ['hy'] } });
  assert.match(only, /Always reply in Armenian only, whatever language or alphabet the customer writes in\./);
  assert.doesNotMatch(only, /one of:/);
});

test('connecting Instagram subscribes the account to DM, comment and seen webhooks', async () => {
  for (const name of ['META_INSTAGRAM_APP_ID','META_INSTAGRAM_APP_SECRET','META_INSTAGRAM_REDIRECT_URI','META_WEBHOOK_VERIFY_TOKEN','HANSORA_AUTOMATION_OAUTH_SECRET']) process.env[name] ||= 'test';
  const { subscribeInstagramWebhooks } = await import('../../lib/automation/meta.mjs');
  let called;
  const fetchImpl = async (url, options) => { called = { url: String(url), method: options.method }; return { ok: true, status: 200, json: async () => ({ success: true }) }; };
  assert.deepEqual(await subscribeInstagramWebhooks('token123', fetchImpl), ['messages','messaging_postbacks','messaging_seen','standby','messaging_handover','messaging_referral','comments','live_comments']);
  assert.equal(called.method, 'POST');
  assert.match(called.url, /subscribed_fields=messages%2Cmessaging_postbacks%2Cmessaging_seen%2Cstandby%2Cmessaging_handover%2Cmessaging_referral%2Ccomments%2Clive_comments&access_token=token123/);
});

test('Instagram DMs are read from both webhook formats (messaging and changes)', async () => {
  const { extractInstagramMessages } = await import('../../lib/automation/meta.mjs');
  const event = { sender: { id: 'customer1' }, recipient: { id: 'business1' }, timestamp: 1759150000000, message: { mid: 'mid.1', text: 'barev' } };
  const viaMessaging = extractInstagramMessages({ object: 'instagram', entry: [{ id: 'business1', messaging: [event] }] });
  const viaChanges = extractInstagramMessages({ object: 'instagram', entry: [{ id: 'business1', changes: [{ field: 'messages', value: event }] }] });
  assert.equal(viaMessaging.length, 1);
  assert.deepEqual(viaChanges, viaMessaging);
  assert.equal(viaChanges[0].text, 'barev');
  const echo = extractInstagramMessages({ object: 'instagram', entry: [{ id: 'business1', changes: [{ field: 'messages', value: { ...event, message: { mid: 'mid.2', text: 'hi', is_echo: true } } }] }] });
  assert.equal(echo.length, 0);
});

test('if Meta rejects the comments subscription, DMs are still subscribed without it', async () => {
  const { subscribeInstagramWebhooks } = await import('../../lib/automation/meta.mjs');
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return urls.length <= 2 ? { ok: false, status: 400, json: async () => ({ error: { message: 'comments requires advanced access' } }) } : { ok: true, status: 200, json: async () => ({ success: true }) }; };
  assert.deepEqual(await subscribeInstagramWebhooks('t', fetchImpl), ['messages','messaging_postbacks','messaging_seen','standby','messaging_handover']);
  assert.match(urls[1], /subscribed_fields=messages%2Cmessaging_postbacks%2Cmessaging_seen%2Cstandby%2Cmessaging_handover%2Ccomments&/);
  assert.match(urls[2], /subscribed_fields=messages%2Cmessaging_postbacks%2Cmessaging_seen%2Cstandby%2Cmessaging_handover&/);
});

test('customer messages delivered on standby (another app or Meta AI controls the thread) are answered too', async () => {
  const { extractInstagramMessages } = await import('../../lib/automation/meta.mjs');
  const event = { sender: { id: 'customer1' }, recipient: { id: 'business1' }, timestamp: 1759150000000, message: { mid: 'mid.s1', text: 'barev' } };
  const found = extractInstagramMessages({ object: 'instagram', entry: [{ id: 'business1', standby: [event] }] });
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'barev');
});
