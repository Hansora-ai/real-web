import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWaitingNote, waitingNoteText, waitsForTeam } from '../../lib/automation/waiting-note.mjs';

const waiting = { id: 'c1', ai_enabled: false, status: 'needs_attention' };
const deps = (last, inserted = { id: 'm1' }) => {
  const calls = { inserts: [], updates: [] };
  return { calls, deps: {
    first: async path => path.includes('automation_messages') ? last : { primary_language: 'hy' },
    serviceInsert: async (table, value) => { calls.inserts.push(value); return inserted; },
    serviceUpdate: async (table, query, value) => { calls.updates.push(value); }
  } };
};

test('a chat waiting for the team gets one short note in the employee language', async () => {
  const { calls, deps: d } = deps({ id: 'ai-handoff', sender_type: 'ai', metadata: {} });
  const sent = [];
  assert.equal(await sendWaitingNote({ businessId: 'b', conversation: waiting, settings: {}, provider: 'telegram', send: async text => sent.push(text), deps: d }), true);
  assert.equal(sent[0], waitingNoteText('hy'));
  assert.equal(calls.inserts[0].idempotency_key, 'waiting-note:c1:ai-handoff');
  assert.equal(calls.inserts[0].billable, false);
  assert.equal(calls.updates[0].status, 'sent');
});

test('no second note, and none when the team is already writing or the AI is on', async () => {
  const send = async () => { throw new Error('must not send'); };
  assert.equal(await sendWaitingNote({ businessId: 'b', conversation: waiting, settings: {}, provider: 'x', send, deps: deps({ id: 'n', sender_type: 'system', metadata: { waiting_note: true } }).deps }), false);
  assert.equal(await sendWaitingNote({ businessId: 'b', conversation: waiting, settings: {}, provider: 'x', send, deps: deps({ id: 'h', sender_type: 'human', metadata: {} }).deps }), false);
  assert.equal(waitsForTeam({ ai_enabled: true, status: 'open' }), false);
  assert.equal(waitsForTeam({ ai_enabled: false, status: 'human_handling' }), false);
  assert.equal(waitsForTeam(waiting, { automatic_replies: false }), false);
  assert.equal(waitingNoteText('xx'), waitingNoteText('en'));
});
