import test from 'node:test';
import assert from 'node:assert/strict';
import { askGeminiText, cleanKnowledgeText, knowledgeForPrompt, splitPassages, KNOWLEDGE_FULL_LIMIT } from '../../lib/automation/providers/gemini.mjs';
import { aiEngineFor, generateAutomationReply } from '../../lib/automation/provider.mjs';

const ok = data => ({ ok: true, status: 200, json: async () => data });

test('Gemini engine runs tools in our code, returns thought signatures unchanged, and answers from the result', async () => {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) return ok({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'check_availability', args: { date: '2026-10-10' } }, thoughtSignature: 'sig-1' }] } }], usageMetadata: { promptTokenCount: 5000, cachedContentTokenCount: 4000, candidatesTokenCount: 20 } });
    return ok({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: 'We have 18:00 free on Saturday.' }] } }], usageMetadata: { promptTokenCount: 5100, candidatesTokenCount: 15, thoughtsTokenCount: 40 } });
  };
  const ran = [];
  const reply = await askGeminiText({ systemInstruction: 'RULES', tools: [{ name: 'check_availability', description: 'x', parameters: { type: 'object', properties: { date: { type: 'string' } } } }], text: 'Saturday evening?', context: 'history', key: 'k', fetchImpl, onToolCall: async (name, args) => { ran.push([name, args]); return { ok: true, slots: ['18:00'] }; } });
  assert.equal(reply.text, 'We have 18:00 free on Saturday.');
  assert.deepEqual(ran, [['check_availability', { date: '2026-10-10' }]]);
  assert.equal(reply.toolCalls[0].name, 'check_availability');
  assert.equal(bodies[0].systemInstruction.parts[0].text, 'RULES');
  assert.deepEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(bodies[0].tools[0].functionDeclarations[0].name, 'check_availability');
  assert.equal(bodies[1].contents[1].parts[0].thoughtSignature, 'sig-1');
  assert.deepEqual(bodies[1].contents[2].parts[0].functionResponse.response.result, { ok: true, slots: ['18:00'] });
  assert.match(bodies[0].contents[0].parts[0].text, /history/); assert.match(bodies[0].contents[0].parts[1].text, /Saturday evening\?/);
  assert.deepEqual(reply.usage, { input: 10100, cached: 4000, output: 75 });
});

test('A failing Gemini reply falls back to the ElevenLabs agent, so the customer always gets an answer', async () => {
  const old = { ...process.env };
  process.env.AUTOMATION_GEMINI_BUSINESSES = 'biz-g'; process.env.GOOGLE_API_KEY = 'k';
  try {
    assert.equal(aiEngineFor('biz-g'), 'gemini'); assert.equal(aiEngineFor('other'), 'gemini');
    process.env.AUTOMATION_AI_ENGINE = 'elevenlabs'; assert.equal(aiEngineFor('other'), 'elevenlabs'); assert.equal(aiEngineFor('biz-g'), 'gemini'); delete process.env.AUTOMATION_AI_ENGINE;
    process.env.AUTOMATION_ELEVENLABS_BUSINESSES = 'biz-g'; assert.equal(aiEngineFor('biz-g'), 'elevenlabs'); delete process.env.AUTOMATION_ELEVENLABS_BUSINESSES;
    // The direct engine cannot load this business (no database here): it must use the agent instead of failing.
    let agentAsked = false;
    class FakeSocket { constructor() { this.l = {}; setTimeout(() => this.emit('open'), 0); } addEventListener(t, f) { (this.l[t] ||= []).push(f); } emit(t, d) { (this.l[t] || []).forEach(f => f(d)); }
      send(raw) { const m = JSON.parse(raw); if (m.type === 'conversation_initiation_client_data') setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'c1' } }) }), 0);
        if (m.type === 'user_message') { agentAsked = true; setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'agent_response', agent_response_event: { agent_response: 'Hello from the agent.' } }) }), 0); } } close() {} }
    process.env.ELEVENLABS_API_KEY = 'x';
    const fetchImpl = async url => String(url).includes('get-signed-url') ? ok({ signed_url: 'wss://x' }) : ok({});
    const reply = await generateAutomationReply({ businessId: 'biz-g', providerResourceId: 'agent-1', text: 'hi', context: '', channel: 'test', fetchImpl, WebSocketImpl: FakeSocket });
    assert.equal(agentAsked, true); assert.equal(reply.text, 'Hello from the agent.'); assert.equal(reply.engine, 'elevenlabs');
  } finally { process.env = old; }
});

test('Knowledge: small knowledge is given whole; files are cleaned and split into passages', async () => {
  assert.equal(cleanKnowledgeText('<p>Prices</p><script>x()</script><div>Pizza&nbsp;5&amp;6</div>'), 'Prices\n Pizza 5&6');
  const small = await knowledgeForPrompt([{ name: 'Menu', text: 'Margherita 3500' }, { name: 'FAQ', text: 'We deliver.' }], 'pizza');
  assert.match(small, /### Menu\nMargherita 3500/); assert.match(small, /### FAQ\nWe deliver\./);
  const passages = splitPassages('Doc', ('Paragraph about sofas. '.repeat(40) + '\n\n').repeat(10));
  assert.ok(passages.length > 3 && passages.every(item => item.text.length <= 1800));
  // Large knowledge without a working search still gives the AI something (never fails the reply).
  const large = await knowledgeForPrompt([{ name: 'Big', text: 'x '.repeat(KNOWLEDGE_FULL_LIMIT) }], 'q', { key: '', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.ok(large.length > 1000 && large.length <= KNOWLEDGE_FULL_LIMIT);
});

test('Buying stage runs only for chats quiet for 30 minutes that changed since their last check', async () => {
  const { pickQuietChats } = await import('../../netlify/functions/automation-sales-stage.mjs');
  const now = Date.parse('2026-10-08T12:00:00Z'), at = minutes => new Date(now - minutes * 60000).toISOString();
  const chats = [
    { id: 'quiet-new', channel_type: 'instagram_dm', last_message_at: at(40), sales_updated_at: null },
    { id: 'quiet-changed', channel_type: 'whatsapp', last_message_at: at(45), sales_updated_at: at(90) },
    { id: 'already-checked', channel_type: 'instagram_dm', last_message_at: at(60), sales_updated_at: at(20) },
    { id: 'still-talking', channel_type: 'instagram_dm', last_message_at: at(5), sales_updated_at: null },
    { id: 'test-chat', channel_type: 'test', last_message_at: at(50), sales_updated_at: null }
  ];
  assert.deepEqual((await pickQuietChats(chats, now)).map(chat => chat.id), ['quiet-new', 'quiet-changed']);
});

test('A voice note reaches the AI as text with its language hint, whichever engine answers', async () => {
  const { mediaMessage } = await import('../../lib/automation/media.mjs');
  const voice = mediaMessage({ source: 'audio', media: { kind: 'audio', transcript: 'Բարև, ունե՞ք կանաչ բազկաթոռ', language: 'hye' } });
  assert.equal(voice.aiText, 'Բարև, ունե՞ք կանաչ բազկաթոռ');
  assert.match(voice.content, /^🎤 Voice message: /);
  assert.match(voice.note, /They spoke Armenian/);
  const bodies = [];
  const fetchImpl = async (url, options) => { bodies.push(JSON.parse(options.body)); return ok({ candidates: [{ content: { role: 'model', parts: [{ text: 'Այո, ունենք։' }] } }] }); };
  await askGeminiText({ systemInstruction: 'RULES', text: voice.aiText, context: `Earlier chat\n${voice.note}`, key: 'k', fetchImpl });
  assert.match(bodies[0].contents[0].parts[0].text, /They spoke Armenian/);
  assert.match(bodies[0].contents[0].parts[1].text, /կանաչ բազկաթոռ/);
});
