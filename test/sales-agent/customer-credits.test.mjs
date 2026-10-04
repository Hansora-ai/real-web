import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
const { executeTool } = await import('../../lib/sales-agent/tools.mjs');

test('prices and packages expose only website credit units and retain package selection', async () => {
  const quote = (await executeTool('get_model_current_price', { model_id: 'seedance25', duration: 5, resolution: '720p' })).quote;
  assert(quote, 'Supported model must return a quote');
  assert.equal(quote.displayedCredits, quote.unitDisplayedCredits);
  assert.equal(quote.displayedCredits, 190);
  const batch = (await executeTool('get_model_current_price', { model_id: 'seedance25', duration: 5, resolution: '720p', quantity: 2 })).quote;
  assert.equal(batch.displayedCredits, 380);
  assert.equal(batch.unitDisplayedCredits, 190);
  assert(!('internalCredits' in quote));
  assert(!('unitInternalCredits' in quote));
  const result = await executeTool('get_credit_packages', { currency: 'USD', required_displayed_credits: 1500 });
  assert.equal(result.packages[0].displayedCredits, 1000);
  assert.equal(result.packages[0].price, 9.99);
  assert.equal(result.smallestSufficientPackageId, 'credits_210');
  assert(result.packages.every(entry => !('internalCredits' in entry)));
  assert.deepEqual(result.monthlyPlans.map(plan => [plan.name, plan.price, plan.monthlyDisplayedCredits]), [
    ['Premium', 40, 2500], ['Pro', 64, 4500], ['Pro Max', 120, 10000]
  ]);
  assert(!result.monthlyPlans[0].unlimitedModels.some(model => model.includes('Veo')));
  assert(result.monthlyPlans[1].unlimitedModels.includes('Veo 3.1 Lite: 720p, 8 seconds'));
  assert(result.monthlyPlans[2].unlimitedModels.includes('Kling 2.5 Turbo: 1080p, 5 seconds'));
  assert(result.monthlyPlans.every(plan => /separate queue/.test(plan.queuePolicy)));
  assert(!/InternalCredits/.test(JSON.stringify(result)));
});

test('account balance, generation charges and refunds use the same website credit units', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert(String(url).includes('user_id=eq.customer'), 'Only the authenticated customer is queried');
    let records = [];
    if (String(url).includes('/profiles?')) records = [{ credits: 19, monthly_credits: 3, payg_credits: 16 }];
    if (String(url).includes('/user_generations?')) records = [{ id: 'generation', meta: { status: 'failed', charged_cost: 19, refunded_amount: 19 } }];
    if (String(url).includes('/refund_ledger?')) records = [{ generation_id: 'generation', amount: 19, reason: 'failed' }];
    return new Response(JSON.stringify(records), { status: 200 });
  };
  try {
    const scope = { user: { id: 'customer' } };
    const balance = await executeTool('get_user_credit_balance', {}, scope);
    assert.deepEqual(balance.balance, { displayedCredits: 190, monthlyDisplayedCredits: 30, paygDisplayedCredits: 160 });
    const history = await executeTool('get_user_generation_history', { limit: 1 }, scope);
    assert.equal(history.generations[0].chargedDisplayedCredits, 190);
    assert.equal(history.generations[0].refundedDisplayedCredits, 190);
    const failures = await executeTool('get_recent_failed_generations', { limit: 1 }, scope);
    assert.equal(failures.refunds[0].displayedCredits, 190);
    assert(!('amount' in failures.refunds[0]));
    assert(!/InternalCredits/.test(JSON.stringify({ balance, history, failures })));
    assert.deepEqual(await executeTool('get_user_credit_balance', {}, {}), { ok: false, error: 'login_required' });
  } finally { globalThis.fetch = originalFetch; }
});
