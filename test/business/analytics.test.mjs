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

test("processor report restores foreign payment volume without a guessed FX rate", () => {
  const r = paymentMoney(
    pay({
      currency: "EUR",
      financial: {
        settlement_amount: 2162,
        settlement_currency: "EUR",
        settlement_tax: 375,
        report_gross_usd_cents: 2419,
        report_settlement_amount: 21.62,
        report_settlement_tax: 3.75,
        report_settlement_currency: "EUR",
      },
    }),
  );
  assert.equal(r.known, true);
  assert.equal(r.gross_micro, 24190000);
  assert.equal(r.report_backed, true);
  assert.equal(r.tax_fx_allocated, true);
  assert.equal(r.revenue_micro, Math.round(24.19 * (1 - 3.75 / 21.62) * 1e6));
});
test("missing report tax preserves exact gross volume but does not invent net revenue", () => {
  const r = paymentMoney(
    pay({
      currency: "EUR",
      financial: {
        settlement_amount: 8898,
        settlement_currency: "EUR",
        settlement_tax: null,
        report_gross_usd_cents: 9999,
        report_settlement_amount: 88.98,
        report_settlement_tax: null,
        report_settlement_currency: "EUR",
      },
    }),
  );
  assert.equal(r.known, false);
  assert.equal(r.gross_micro, 99990000);
  assert.equal(r.report_backed, true);
});
test("payment provider counts and volume are separate from tax-exclusive revenue", () => {
  const r = buildDashboard(
    snap({
      payments: [
        pay({
          financial: {
            settlement_amount: 1200,
            settlement_currency: "USD",
            settlement_tax: 200,
          },
        }),
        pay({
          id: 2,
          transaction_id: "y1",
          provider: "yoomoney",
          currency: "USD",
          amount_cents: 990,
          financial: {},
        }),
        pay({
          id: 3,
          transaction_id: "y2",
          provider: "yoomoney",
          currency: "RUB",
          amount_cents: 100000,
          financial: {},
        }),
      ],
    }),
    range,
  );
  assert.equal(r.summary.payments, 3);
  assert.equal(r.summary.gross_volume_micro, 21900000);
  assert.equal(r.summary.sales_micro, 10000000);
  assert.equal(r.summary.unconverted_volume_payments, 1);
  assert.equal(r.summary.unconverted_payments, 2);
  assert.deepEqual(
    r.payment_providers.map((p) => [
      p.provider,
      p.payments,
      p.known_volume_micro,
      p.unconverted,
    ]),
    [
      ["dodopayments", 1, 12000000, 0],
      ["yoomoney", 2, 9900000, 1],
    ],
  );
});
test("new processor report takes precedence over stale webhook settlement values", () => {
  const r = paymentMoney(
    pay({
      financial: {
        settlement_amount: 11000,
        settlement_currency: "USD",
        settlement_tax: 1000,
        report_gross_usd_cents: 9999,
        report_settlement_amount: 99.99,
        report_settlement_tax: 0,
        report_settlement_currency: "USD",
      },
    }),
  );
  assert.equal(r.gross_micro, 99990000);
  assert.equal(r.revenue_micro, 99990000);
});
