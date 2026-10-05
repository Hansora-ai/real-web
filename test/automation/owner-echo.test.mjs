import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInstagramEchoes, extractInstagramMessages } from '../../lib/automation/meta.mjs';
import { processInstagramEcho } from '../../netlify/functions/automation-instagram-echo-background.mjs';

const payload = { object: 'instagram', entry: [{ id: 'biz', messaging: [{ sender: { id: 'biz' }, recipient: { id: 'cust' }, timestamp: 1700000000000, message: { mid: 'm-owner', text: 'I will check and call you', is_echo: true } }] }] };

test('messages sent from the business account are echoes, never customer messages', () => {
  assert.deepEqual(extractInstagramMessages(payload), []);
  const [echo] = extractInstagramEchoes(payload);
  assert.deepEqual({ mid: echo.mid, businessId: echo.businessId, customerId: echo.customerId, text: echo.text }, { mid: 'm-owner', businessId: 'biz', customerId: 'cust', text: 'I will check and call you' });
});

function fakeDb({ known = false } = {}) {
  const writes = [];
  return { writes, deps: {
    sleep: async () => {},
    first: async path => path.includes('automation_provider_resources') ? { id: 'acc', business_id: 'b1' } : path.includes('automation_messages') ? (known ? { id: 'x' } : null) : path.includes('automation_conversations') ? { id: 'conv1', ai_enabled: true, status: 'open' } : null,
    serviceInsert: async (table, row) => { writes.push({ table, row }); return row; },
    serviceUpdate: async (table, query, value) => { writes.push({ table, query, value }); return [value]; }
  } };
}

test('the owner typing in the Instagram app pauses the AI in that chat until turned back on', async () => {
  const db = fakeDb();
  const result = await processInstagramEcho(extractInstagramEchoes(payload)[0], db.deps);
  assert.equal(result.paused, true);
  assert.equal(db.writes[0].row.sender_type, 'human');
  assert.equal(db.writes[0].row.content, 'I will check and call you');
  assert.deepEqual({ ai: db.writes[1].value.ai_enabled, status: db.writes[1].value.status }, { ai: false, status: 'human_handling' });
});

test("Hansora's own messages (AI, inbox, automations) do not pause anything", async () => {
  const db = fakeDb({ known: true });
  assert.equal((await processInstagramEcho(extractInstagramEchoes(payload)[0], db.deps)).ours, true);
  assert.equal(db.writes.length, 0);
  const viaApp = fakeDb();
  assert.equal((await processInstagramEcho({ ...extractInstagramEchoes(payload)[0], appId: '123' }, { ...viaApp.deps, ownAppId: '123' })).ours, true);
});

