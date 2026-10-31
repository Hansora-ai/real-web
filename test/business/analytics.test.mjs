import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboard,
  paymentMoney,
  estimateCost,
} from "../../lib/business/analytics.mjs";
const pay = (over = {}) => ({
  id: 1,
  transaction_id: "p1",
  uid: "buyer",
  provider: "dodopayments",
  credits: 90,
  status: "succeeded",
  paid_at: "2026-10-30T10:00:00Z",
  currency: "IDR",
  amount_cents: 18000000,
  financial: {
    settlement_amount: 999,
    settlement_currency: "USD",
    settlement_tax: 0,
    card_issuing_country: "US",
  },
  ...over,
});
const gen = (over = {}) => ({
  id: "g1",
  user_id: "buyer",
  created_at: "2026-10-30T11:00:00Z",
  provider: "Grok",
  kind: "video",
  model: "grok-imagine/text-to-video",
  source: "kie",
  resolution: "720p",
  duration: 6,
  status: "done",
  charged_cost: 1.8,
  surface: "ChatGPT",
  ...over,
});
const snap = (over) => ({
  generated_at: "2026-10-31T00:00:00Z",
  payments: [pay()],
  generations: [gen()],
  registrations: [],
  buyers: [],
  refunds: [],
  expenses: [],
  settings: {},
  ...over,
});
const range = { start: "2026-10-30", end: "2026-10-30" };
test("uses settlement currency, excludes tax and never adds IDR as USD", () => {
  const r = paymentMoney(pay());
  assert.equal(r.revenue_micro, 9990000);
  assert.equal(r.fee_micro, 799600);
  const eur = paymentMoney(
    pay({
      financial: {
        settlement_amount: 999,
        settlement_currency: "EUR",
        settlement_tax: 0,
      },
    }),
  );
  assert.equal(eur.known, false);
});
test("credit costs are never mistaken for provider USD; provider refund is explicit", () => {
  const r = estimateCost(gen());
  assert.equal(r.micro, 135000);
  assert.equal(estimateCost(gen({ status: "failed", refunded: "true" })), null);
  assert.equal(
    estimateCost(gen({ status: "failed", provider_refunded: true })).micro,
    0,
  );
});
test("dated Wan promotional rates expire and old history is not silently repriced", () => {
  const g = gen({
    model: "wan3.0-video",
    provider: "Wan 3.0",
    source: "reapi",
    resolution: "480p",
    billed_seconds: 5,
  });
  assert.equal(estimateCost(g).micro, 145000);
  assert.equal(
    estimateCost({ ...g, created_at: "2026-12-01T00:00:00Z" }),
    null,
  );
  assert.equal(
    estimateCost({ ...g, created_at: "2026-10-17T00:00:00Z" }),
    null,
  );
});
test("same-day pre-purchase trial remains nonbuyer usage and duplicate payment IDs are not counted twice", () => {
  const report = buildDashboard(
    snap({
      payments: [pay(), pay()],
      generations: [gen({ created_at: "2026-10-30T09:00:00Z" })],
    }),
    range,
  );
  assert.equal(report.summary.payments, 1);
  assert.equal(report.summary.nonbuyer_generations, 1);
  assert.equal(report.summary.used_buyers, 0);
});
test("unknown provider costs block final profit rather than silently becoming free", () => {
  const report = buildDashboard(
    snap({ generations: [gen({ model: "unknown-model" })] }),
    range,
  );
  assert.equal(report.summary.unpriced_jobs, 1);
  assert.equal(report.summary.profit_micro, null);
  assert.ok(report.issues.some((i) => i.code === "cost"));
});
test("failure rate excludes pending jobs; errors normalize dynamic numbers", () => {
  const report = buildDashboard(
    snap({
      generations: [
        gen(),
        gen({
          id: "g2",
          status: "failed",
          error: "Insufficient credits. Required: 20",
        }),
        gen({
          id: "g3",
          status: "failed",
          error: "Insufficient credits. Required: 30",
        }),
        gen({ id: "g4", status: "processing" }),
      ],
    }),
    range,
  );
  assert.equal(report.summary.failure_rate, 2 / 3);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].count, 2);
});
test("internal account costs remain business costs while excluded from customer activity", () => {
  const report = buildDashboard(
    snap({
      generations: [gen({ user_id: "45c5cfc7-090e-491f-a304-05f863bbdf85" })],
    }),
    range,
  );
  assert.equal(report.summary.successful, 0);
  assert.equal(report.summary.internal_cost_micro, 135000);
});
test("ledger and legacy metadata credit refunds are combined without double-counting", () => {
  const report = buildDashboard(
    snap({
      refunds: [{ run_id: "r1", user_id: "buyer", amount: 1.8 }],
      metadata_refunds: [
        { run_id: "r1", user_id: "buyer", amount: 1.8 },
        { run_id: "r2", user_id: "buyer", amount: 2 },
      ],
    }),
    range,
  );
  assert.equal(report.summary.credits_refunded, 38);
});
test("zero-decimal settlement currencies are not divided by a fictitious 100", () => {
  const p = pay({
    financial: {
      settlement_amount: 1500,
      settlement_currency: "JPY",
      settlement_tax: 0,
      card_issuing_country: "JP",
    },
  });
  assert.equal(paymentMoney(p, { JPY: 0.006 }).revenue_micro, 9000000);
});
