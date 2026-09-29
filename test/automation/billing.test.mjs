import assert from 'node:assert/strict';
import test from 'node:test';
import { affordableVoiceSeconds, automationPrices, canAfford, chargeCredits, refundCredits, toDisplay, voiceCredits } from '../../lib/automation/billing.mjs';

test('prices follow the ⚡ display: 1 AI reply = 1⚡, 1 phone minute = 8⚡', () => {
  const prices = automationPrices();
  assert.equal(toDisplay(prices.aiReply), 1);
  assert.equal(toDisplay(prices.voiceMinute), 8);
  assert.equal(voiceCredits(60), 0.8);
  assert.equal(voiceCredits(61), 0.9); // rounded up to the next whole ⚡
  assert.equal(voiceCredits(0), 0);
  assert.equal(affordableVoiceSeconds(0.8), 60);
  assert.equal(affordableVoiceSeconds(2), 150);
});

// A tiny in-memory Supabase: profiles.credits with compare-and-swap PATCH, and the charges ledger.
function fakeDb({ credits = 1, raceOnce = false } = {}) {
  const state = { credits, charges: [], patches: 0 };
  let raced = !raceOnce;
  const deps = {
    rows: value => Array.isArray(value) ? value : [],
    first: async path => {
      if (path.includes('automation_businesses')) return { owner_user_id: 'user-1' };
      if (path.includes('/profiles')) return { credits: state.credits };
      if (path.includes('automation_credit_charges')) { const key = decodeURIComponent(path.match(/idempotency_key=eq\.([^&]+)/)[1]); return state.charges.find(row => row.idempotency_key === key) || null; }
      return null;
    },
    serviceInsert: async (table, value) => { if (state.charges.some(row => row.idempotency_key === value.idempotency_key)) return null; const row = { id: `c${state.charges.length + 1}`, ...value }; state.charges.push(row); return row; },
    serviceUpdate: async (table, query, value) => { const row = state.charges.find(item => query === `id=eq.${item.id}`); Object.assign(row, value); return [row]; },
    supabaseRequest: async (path, options) => {
      if (path.startsWith('/rest/v1/profiles')) {
        const expected = Number(decodeURIComponent(path.match(/credits=eq\.([^&]+)/)[1]));
        if (!raced) { raced = true; state.credits = Math.round((state.credits - 0.1) * 10) / 10; return []; } // someone else spent first
        if (Math.abs(expected - state.credits) > 1e-9) return [];
        state.patches++; state.credits = options.body.credits; return [{ credits: state.credits }];
      }
      if (path.startsWith('/rest/v1/automation_credit_charges')) {
        const key = decodeURIComponent(path.match(/idempotency_key=eq\.([^&]+)/)[1]);
        const row = state.charges.find(item => item.idempotency_key === key && item.status === 'charged');
        if (!row) return []; Object.assign(row, options.body); return [row];
      }
      return [];
    }
  };
  return { state, deps };
}

test('a reply is charged exactly once, even if the webhook is retried', async () => {
  const { state, deps } = fakeDb({ credits: 1 });
  const first = await chargeCredits({ businessId: 'b', idempotencyKey: 'usage:instagram:m1', kind: 'ai_reply', credits: 0.1 }, deps);
  const retry = await chargeCredits({ businessId: 'b', idempotencyKey: 'usage:instagram:m1', kind: 'ai_reply', credits: 0.1 }, deps);
  assert.deepEqual([first.ok, first.charged, first.balance], [true, 0.1, 0.9]);
  assert.equal(retry.duplicate, true);
  assert.equal(state.credits, 0.9);
  assert.equal(state.patches, 1);
});

test('no balance means no charge and no negative credits; a lost race is retried safely', async () => {
  const empty = fakeDb({ credits: 0.05 });
  const denied = await chargeCredits({ businessId: 'b', idempotencyKey: 'k1', kind: 'ai_reply', credits: 0.1 }, empty.deps);
  assert.equal(denied.error, 'insufficient_credits');
  assert.equal(empty.state.credits, 0.05);
  assert.equal(empty.state.charges[0].status, 'insufficient');
  assert.deepEqual(await canAfford('b', 0.1, empty.deps), { ok: false, balance: 0.05, userId: 'user-1' });
  const busy = fakeDb({ credits: 1, raceOnce: true });
  const charged = await chargeCredits({ businessId: 'b', idempotencyKey: 'k2', kind: 'ai_reply', credits: 0.1 }, busy.deps);
  assert.equal(charged.ok, true);
  assert.equal(busy.state.credits, 0.8); // 0.1 by the other spender + 0.1 by us
});

test('a finished call takes what is left instead of failing, and refunds return credits once', async () => {
  const { state, deps } = fakeDb({ credits: 0.5 });
  const call = await chargeCredits({ businessId: 'b', idempotencyKey: 'usage:phone:c1', kind: 'voice', credits: voiceCredits(120), allowPartial: true }, deps);
  assert.deepEqual([call.ok, call.charged, call.partial, state.credits], [true, 0.5, true, 0]);
  const refund = await refundCredits('usage:phone:c1', deps);
  assert.deepEqual([refund.ok, refund.refunded, state.credits], [true, 0.5, 0.5]);
  assert.equal((await refundCredits('usage:phone:c1', deps)).error, 'nothing_to_refund');
});
