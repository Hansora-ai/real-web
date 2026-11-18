import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerRepliedOnInstagram } from '../../lib/automation/owner-reply.mjs';

const BASE = { businessId: 'b1', conversationId: 'c1', instagramAccountId: 'ig1', customerId: 'cust1', since: '2026-11-18T16:59:22.307Z' };
// A stand-in for the database: echoes since the customer's message, and Hansora's saved messages.
function deps({ echoes = [], saved = {}, sameText = {} } = {}) {
  return {
    rows: value => value,
    supabaseRequest: async path => { assert.match(path, /event_type=eq\.instagram_echo/); assert.match(path, /payload->>customerId=eq\.cust1/); return echoes.map(payload => ({ payload })); },
    first: async path => {
      const mid = Object.keys(saved).find(id => path.includes(`external_message_id.eq.${encodeURIComponent(id)}`));
      if (mid) return saved[mid];
      const text = Object.keys(sameText).find(value => path.includes(`content=eq.${encodeURIComponent(value)}`));
      return text ? sameText[text] : null;
    }
  };
}

test('the owner typed in the Instagram app since the customer wrote: the AI must not send', async () => {
  assert.equal(await ownerRepliedOnInstagram(BASE, deps({ echoes: [{ mid: 'm1', text: 'qich grii araaa' }] })), true);
});

test("Hansora's own earlier messages are not the owner", async () => {
  assert.equal(await ownerRepliedOnInstagram(BASE, deps({ echoes: [{ mid: 'm1', text: 'Hello!' }], saved: { m1: { sender_type: 'ai', metadata: {} } } })), false);
  assert.equal(await ownerRepliedOnInstagram(BASE, deps({ echoes: [{ mid: 'm2', text: 'Hello!' }], sameText: { 'Hello!': { metadata: {} } } })), false);
  assert.equal(await ownerRepliedOnInstagram(BASE, deps({ echoes: [{ mid: 'm3', text: '📎 Sent an attachment' }] })), false);
});

test('an echo already saved as the owner message counts as the owner', async () => {
  assert.equal(await ownerRepliedOnInstagram(BASE, deps({ echoes: [{ mid: 'm1', text: 'hi' }], saved: { m1: { sender_type: 'human', metadata: { source: 'instagram_app' } } } })), true);
});

test('no echoes, or missing details: the AI answers as usual', async () => {
  assert.equal(await ownerRepliedOnInstagram(BASE, deps()), false);
  assert.equal(await ownerRepliedOnInstagram({ ...BASE, since: '' }, deps({ echoes: [{ mid: 'm1', text: 'x' }] })), false);
});
