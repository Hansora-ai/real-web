import test from 'node:test';
import assert from 'node:assert/strict';
import { askElevenLabsText, enableResponseCompleteEvent, looksFinished, trimCutOffReply } from '../../lib/automation/providers/elevenlabs.mjs';

process.env.ELEVENLABS_API_KEY ||= 'test-key';
class FakeSocket {
  static script = [];
  constructor() { this.sent = []; this.listeners = {}; setTimeout(() => this.emit('open', {}), 0); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  emit(type, event) { for (const handler of this.listeners[type] || []) handler(event); }
  send(raw) { const message = JSON.parse(raw); this.sent.push(message); const reply = FakeSocket.script.shift(); if (reply) setTimeout(() => reply(this, message), 0); }
  close() {}
}
const event = (type, body = {}) => ({ data: JSON.stringify({ type, ...body }) });
const say = text => event('agent_response', { agent_response_event: { agent_response: text } });
const start = socket => socket.emit('message', event('conversation_initiation_metadata', { conversation_initiation_metadata_event: { conversation_id: 'c1' } }));
const fetchImpl = async () => new Response(JSON.stringify({ signed_url: 'wss://example.test' }), { headers: { 'content-type': 'application/json' } });

test('a half sentence followed by a slow action is not sent as the reply (the bug in the screenshot)', async () => {
  FakeSocket.script = [start, null, socket => {
    socket.emit('message', say('Այո, տեսնում եմ, բայց մենք զբաղվում ենք մի'));
    // The AI takes 2 seconds to decide on an action: the old 1.5-second rule sent the half sentence.
    setTimeout(() => socket.emit('message', event('client_tool_call', { client_tool_call: { tool_name: 'search_products', tool_call_id: 't1', parameters: { query: 'video' } } })), 2000);
  }, socket => socket.emit('message', say('Այո, մենք վաճառում ենք կահույք։'))];
  const result = await askElevenLabsText({ agentId: 'a-slow', text: 'do you see this video?', context: 'ctx', fetchImpl, WebSocketImpl: FakeSocket, onToolCall: async () => ({ ok: true, products: [] }), timeoutMs: 20000 });
  assert.equal(result.text, 'Այո, մենք վաճառում ենք կահույք։');
});

test('agent_response_complete ends the reply right away, including several messages', async () => {
  FakeSocket.script = [start, null, socket => { socket.emit('message', say('First part.')); socket.emit('message', say('Second part.')); socket.emit('message', event('agent_response_complete')); }];
  const began = Date.now();
  const result = await askElevenLabsText({ agentId: 'a-complete', text: 'hi', context: 'ctx', fetchImpl, WebSocketImpl: FakeSocket, onToolCall: async () => ({ ok: true }) });
  assert.equal(result.text, 'First part.\n\nSecond part.');
  assert.ok(Date.now() - began < 1500);
});

test('a corrected message replaces the original', async () => {
  FakeSocket.script = [start, null, socket => { socket.emit('message', say('Wrong price 10.')); socket.emit('message', event('agent_response_correction', { agent_response_correction_event: { original_agent_response: 'Wrong price 10.', corrected_agent_response: 'Price 12.' } })); socket.emit('message', event('agent_response_complete')); }];
  const result = await askElevenLabsText({ agentId: 'a-correct', text: 'price?', context: 'ctx', fetchImpl, WebSocketImpl: FakeSocket, onToolCall: async () => ({ ok: true }) });
  assert.equal(result.text, 'Price 12.');
});

test('finished-looking text in any script, and the complete event is only added to the existing list', async () => {
  assert.equal(looksFinished('Done!'), true); assert.equal(looksFinished('Պատրաստ է։'), true); assert.equal(looksFinished('Thanks 🙏'), true);
  assert.equal(looksFinished('we deal with a'), false);
  const calls = [];
  const request = async (path, options = {}) => { calls.push([options.method || 'GET', options.body ? JSON.parse(options.body) : null]); return { conversation_config: { conversation: { client_events: ['audio', 'agent_response', 'client_tool_call'] } } }; };
  assert.equal(await enableResponseCompleteEvent('agent1', request), true);
  assert.deepEqual(calls[1], ['PATCH', { conversation_config: { conversation: { client_events: ['audio', 'agent_response', 'client_tool_call', 'agent_response_complete'] } } }]);
  const unknown = async () => ({ conversation_config: { conversation: {} } });
  assert.equal(await enableResponseCompleteEvent('agent2', unknown), false);
});

test('A reply cut off mid-word is sent up to its last full sentence', () => {
  assert.equal(trimCutOffReply('Կներեք, իմ սխալն էր։ Վերջին տեսանյութը մեր հարթակի մասին է և ցույ'), 'Կներեք, իմ սխալն էր։');
  assert.equal(trimCutOffReply('Sorry, my mistake. The last video is about our platform and sho'), 'Sorry, my mistake.');
  assert.equal(trimCutOffReply('Done!'), 'Done!');
  assert.equal(trimCutOffReply('An answer with no full sentence that was cut off in the mid'), 'An answer with no full sentence that was cut off in the mid');
});

test('A short reply cut off after its first sentence is trimmed too', () => {
  assert.equal(trimCutOffReply('Ուրախ եմ լսել։ Քանի'), 'Ուրախ եմ լսել։');
  assert.equal(trimCutOffReply('Hi Anna'), 'Hi Anna');
});
