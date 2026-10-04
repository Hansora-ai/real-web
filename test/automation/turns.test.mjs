import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNewerCustomerMessage, waitForPendingMedia } from '../../lib/automation/turns.mjs';

test('an older message steps aside when the customer wrote again', async () => {
  let asked = '';
  const newer = await hasNewerCustomerMessage({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:00.000Z', createdAt: '2026-10-04T12:00:01.000Z', messageId: 'm1' }, { first: async path => { asked = path; return { id: 'm2' }; } });
  assert.equal(newer, true);
  assert.match(asked, /sender_type=eq\.customer/);
  assert.match(asked, /id=neq\.m1/);
  assert.equal(await hasNewerCustomerMessage({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:00.000Z' }, { first: async () => null }), false);
});

test('the newest message waits for an earlier photo still being read, then answers', async () => {
  let checks = 0;
  const waited = await waitForPendingMedia({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:05.000Z', messageId: 'm2' }, { first: async () => (++checks < 3 ? { id: 'm1' } : null), sleep: async () => {} });
  assert.equal(waited, true);
  assert.equal(checks, 3);
  assert.equal(await waitForPendingMedia({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:05.000Z' }, { first: async () => null, sleep: async () => {} }), false);
  let now = 0;
  const gaveUp = await waitForPendingMedia({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:05.000Z' }, { first: async () => ({ id: 'stuck' }), sleep: async () => { now += 5000; }, now: () => now, maxMs: 20000 });
  assert.equal(gaveUp, true);
});

test('several quick questions without a reply are all answered together', async () => {
  const { unansweredCustomerMessages, burstNote } = await import('../../lib/automation/turns.mjs');
  const rowsNewestFirst = [
    { sender_type: 'customer', content: 'when do I see the issue?' },
    { sender_type: 'customer', content: 'how can I get that' },
    { sender_type: 'ai', content: 'Here is our pricing.' },
    { sender_type: 'customer', content: 'hi' }
  ];
  const burst = await unansweredCustomerMessages({ conversationId: 'c1', occurredAt: '2026-10-04T12:00:00Z' }, { supabaseRequest: async () => rowsNewestFirst, rows: value => value });
  assert.deepEqual(burst, ['how can I get that', 'when do I see the issue?']);
  const note = burstNote(burst);
  assert.match(note, /1\. how can I get that\n2\. when do I see the issue\?/);
  assert.match(note, /answer every one of them explicitly/);
  assert.equal(burstNote(['only one']), '');
});
