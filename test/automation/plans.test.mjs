import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATION_PLANS, automationPricesFor, planIsActive, pricesForPlan, replyPrice } from '../../lib/automation/billing.mjs';

test('Pay as you go: 1.2⚡ per reply, 2⚡ for a photo or video, 1⚡ per comment run, 8⚡ per call minute', () => {
  const rates = pricesForPlan(null);
  assert.deepEqual([rates.aiReply, rates.mediaReply, rates.commentRun, rates.voiceMinute, rates.testReply], [0.12, 0.2, 0.1, 0.8, 0.12]);
  assert.equal(replyPrice(rates, null), 0.12);
  assert.equal(replyPrice(rates, { kind: 'image' }), 0.2);
  assert.equal(replyPrice(rates, { kind: 'video' }), 0.2);
  assert.equal(replyPrice(rates, { kind: 'audio' }), 0.12, 'voice notes cost a normal reply');
});

test('Monthly plans: $1 = 100⚡ and every action is cheaper on bigger plans', () => {
  for (const plan of Object.values(AUTOMATION_PLANS)) assert.equal(plan.credits, plan.price * 10);
  assert.deepEqual(pricesForPlan('automation_starter_monthly').aiReply, 0.1);
  assert.deepEqual(pricesForPlan('automation_growth_monthly').commentRun, 0.05);
  const scale = pricesForPlan('automation_scale_monthly');
  assert.deepEqual([scale.aiReply, scale.commentRun, scale.voiceMinute, scale.mediaReply, scale.testReply], [0.08, 0.03, 0.6, 0.2, 0.08]);
  assert.equal(pricesForPlan('automation_business_monthly').aiReply, 0.09);
});

test('A plan counts only while active and paid (one day of grace for a late renewal)', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(planIsActive({ plan_id: 'automation_growth_monthly', status: 'active', current_period_end: '2026-11-01T00:00:00Z' }, now), true);
  assert.equal(planIsActive({ plan_id: 'automation_growth_monthly', status: 'active', current_period_end: '2026-10-13T00:00:00Z' }, now), true);
  assert.equal(planIsActive({ plan_id: 'automation_growth_monthly', status: 'active', current_period_end: '2026-10-10T00:00:00Z' }, now), false);
  assert.equal(planIsActive({ plan_id: 'automation_growth_monthly', status: 'on_hold' }, now), false);
  assert.equal(planIsActive({ plan_id: 'premium_monthly', status: 'active' }, now), false, 'a Hansora Creative plan does not change Automation prices');
});

test('Prices follow the owner\'s plan, and a failed lookup falls back to pay as you go', async () => {
  const first = async path => path.includes('automation_businesses') ? { owner_user_id: 'u1' } : { plan_id: 'automation_scale_monthly', status: 'active', current_period_end: new Date(Date.now() + 864e5).toISOString() };
  assert.equal((await automationPricesFor('b1', { first })).aiReply, 0.08);
  assert.equal((await automationPricesFor('b1', { first: async path => path.includes('automation_businesses') ? { owner_user_id: 'u1' } : null })).aiReply, 0.12);
  assert.equal((await automationPricesFor('b1', { first: async () => { throw new Error('down'); } })).aiReply, 0.12);
});
