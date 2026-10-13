import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeCredits, refundCredits } from '../../lib/automation/billing.mjs';

// A fake database: profiles.credits keeps ONE decimal like the real column; the carry function works like SQL 17.
function fakeDb({ balance = 100, rpc = true } = {}) {
  const state = { balance, carry: 0, charges: [] };
  const oneDecimal = value => Math.round(value * 10) / 10;
  return {
    state,
    first: async path => {
      if (path.includes('automation_businesses')) return { owner_user_id: 'u1' };
      if (path.includes('/profiles')) return { credits: state.balance };
      if (path.includes('automation_credit_charges')) return null;
      return null;
    },
    serviceInsert: async (table, row) => { const claim = { id: state.charges.length + 1, ...row }; state.charges.push(claim); return claim; },
    serviceUpdate: async (table, filter, patch) => { const id = Number(filter.match(/id=eq\.(\d+)/)?.[1]); Object.assign(state.charges.find(item => item.id === id) || {}, patch); },
    rows: value => Array.isArray(value) ? value : [],
    supabaseRequest: async (path, { body } = {}) => {
      if (path.includes('/rpc/automation_take_fraction')) {
        if (!rpc) throw new Error('function does not exist');
        const total = state.carry + body.p_amount; const due = Math.floor(total * 10 + 1e-9) / 10;
        state.carry = Math.round((total - due) * 10000) / 10000; return due;
      }
      if (path.includes('/profiles')) { state.balance = oneDecimal(body.credits); return [{ credits: state.balance }]; }
      if (path.includes('automation_credit_charges')) { const charge = state.charges.find(item => item.status === 'charged'); if (!charge) return []; charge.status = 'refunded'; return [{ ...charge }]; }
      return [];
    }
  };
}

test('Five 1.2⚡ replies take exactly 6⚡, ten 0.3⚡ comments exactly 3⚡ (balance keeps whole ⚡)', async () => {
  const db = fakeDb({ balance: 100 }); // 100 stored = 1,000⚡
  for (let i = 0; i < 5; i++) assert.equal((await chargeCredits({ businessId: 'b1', idempotencyKey: `r${i}`, kind: 'ai_reply', credits: 0.12 }, db)).charged, 0.12);
  assert.equal(db.state.balance, 99.4); // 1,000⚡ − 6⚡
  assert.equal(db.state.carry, 0);
  for (let i = 0; i < 10; i++) await chargeCredits({ businessId: 'b1', idempotencyKey: `c${i}`, kind: 'comment_run', credits: 0.03 }, db);
  assert.equal(db.state.balance, 99.1); // − 3⚡
  for (let i = 0; i < 3; i++) await chargeCredits({ businessId: 'b1', idempotencyKey: `s${i}`, kind: 'ai_reply', credits: 0.08 }, db);
  assert.equal(db.state.balance, 98.9); // 2.4⚡: 2⚡ taken, 0.4⚡ waiting
  assert.equal(db.state.carry, 0.04);
});

test('A refund gives the exact part back', async () => {
  const db = fakeDb({ balance: 10 });
  await chargeCredits({ businessId: 'b1', idempotencyKey: 'x', kind: 'ai_reply', credits: 0.12 }, db);
  assert.equal(db.state.balance, 9.9); assert.equal(db.state.carry, 0.02);
  await refundCredits('x', db);
  assert.equal(db.state.balance, 10); assert.equal(db.state.carry, 0);
});

test('Out of credits: nothing is taken and the leftover is unchanged', async () => {
  const db = fakeDb({ balance: 0 });
  const result = await chargeCredits({ businessId: 'b1', idempotencyKey: 'y', kind: 'ai_reply', credits: 0.12 }, db);
  assert.equal(result.ok, false); assert.equal(db.state.balance, 0); assert.equal(db.state.carry, 0);
});

test('Before SQL 17 is run, charges round to whole ⚡ and replies keep working', async () => {
  const db = fakeDb({ balance: 10, rpc: false });
  const result = await chargeCredits({ businessId: 'b1', idempotencyKey: 'z', kind: 'ai_reply', credits: 0.12 }, db);
  assert.equal(result.ok, true); assert.equal(db.state.balance, 9.9);
});
