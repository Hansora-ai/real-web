import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStage, stagePrompt, updateSalesStage } from '../../lib/automation/sales-stage.mjs';
import { goalInstructions } from '../../lib/automation/tools.mjs';

test('the goal fits any business and never asks for pushy selling', () => {
  const shop = goalInstructions(new Set(['create_order', 'search_products']));
  assert.match(shop, /choose the right product and order it/);
  assert.match(shop, /never repeat an offer the customer ignored or declined/);
  assert.match(shop, /Never invent discounts, urgency, scarcity/);
  assert.match(goalInstructions(new Set(['create_booking'])), /book the right service/);
  assert.match(goalInstructions(new Set()), /complete, useful answer/);
});

test('the stage answer is checked and cleaned', () => {
  assert.deepEqual(parseStage('{"stage":"ready","interest":"Milan armchair, green, 2","value":360000,"currency":"AMD"}'), { stage: 'ready', interest: 'Milan armchair, green, 2', value: 360000, currency: 'AMD' });
  assert.equal(parseStage('{"stage":"buying"}'), null);
  assert.equal(parseStage('not json'), null);
  assert.equal(parseStage('{"stage":"lost","value":"abc","currency":"dollars"}').value, null);
  assert.match(stagePrompt({ businessName: 'Casa', history: 'Customer: hi' }), /Chat \(oldest first\):\nCustomer: hi/);
});

test('a chat with an order is "done" whatever the model says; the stage is saved on the chat', async () => {
  const updates = [];
  const deps = {
    first: async () => ({ name: 'Casa', category: 'shop' }), rows: value => value,
    supabaseRequest: async path => path.includes('automation_messages') ? [{ sender_type: 'customer', content: 'I take it', occurred_at: '2026-10-05T10:00:00Z' }] : [{ outcome_type: 'order', title: 'Milan armchair' }],
    serviceUpdate: async (table, query, value) => { updates.push(value); return [value]; },
    generate: async () => ({ text: '{"stage":"ready","interest":"Milan armchair","value":180000,"currency":"AMD"}' })
  };
  const result = await updateSalesStage({ businessId: 'b1', conversationId: 'c1' }, deps);
  assert.equal(result.stage, 'done');
  assert.equal(updates[0].sales_stage, 'done');
  assert.equal(updates[0].sales_interest, 'Milan armchair');
});
