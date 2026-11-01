import test from "node:test";
import assert from "node:assert/strict";
import { buildProfit, paymentUsd } from "../../lib/business/profit.mjs";
import { runCost } from "../../lib/business/costs.mjs";
import { OWNER_ID } from "../../lib/business/access.mjs";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg}: ${a} vs ${b}`);

test("provider cost of each run matches the owner's price sheet", () => {
  const cost = (g) => runCost({ status: "done", ...g }).usd;
  close(cost({ provider: "veo3.1lite", model: "veo3_lite", resolution: "720p", charged_cost: 2 }), 0.15, "Veo Lite 720p");
  close(cost({ provider: "veo3.1lite", model: "veo3_lite", resolution: "1080p", charged_cost: 2.5 }), 0.175, "Veo Lite 1080p");
  close(cost({ provider: "Grok", model: "grok-video", charged_cost: 1.8 }), 0.135, "Grok 6 s from credits");
  close(cost({ kind: "video", provider: "Grok", model: "grok-imagine/image-to-video", charged_cost: 1.8 }), 0.135, "Grok image-to-video is a video");
  close(cost({ kind: "image", provider: "Grok", model: "grok-image", charged_cost: 0.5 }), 0.0225, "Grok image");
  close(cost({ provider: "Wan 3.0", model: "wan3.0-video", resolution: "720p", duration: 10, input_seconds: 0 }), 0.58, "Wan 720p 10 s");
  close(cost({ provider: "Wan 3.0", model: "wan3.0-video", resolution: "480p", billed_seconds: 20 }), 0.58, "Wan 480p 10 s + 10 s reference");
  for (const [res, usd] of [["480p", 1.19], ["720p", 2.67], ["1080p", 6.43]])
    close(cost({ provider: "Seedance 2.5", model: "doubao-seedance-2.5-face", resolution: res, duration: 10, input_seconds: 0 }), usd, `Seedance 2.5 ${res}`);
  close(cost({ provider: "Hansora Henshin", model: "doubao-seedance-2.5-face", resolution: "720p", duration: 10, input_seconds: 10 }), 3.202, "Henshin 720p");
  close(cost({ provider: "Hansora Henshin Lite", model: "kling-4.0/reference-to-video", resolution: "720p", duration: 10, input_seconds: 10 }), 1.7, "Henshin Lite 720p");
  close(cost({ provider: "Kling 4.0", model: "kling-4.0/reference-to-video", resolution: "720p", duration: 10, input_seconds: 0 }), 1.425, "Kling 4.0 720p");
  close(cost({ provider: "Nano Banana 2.1", model: "nano-banana-2-1", resolution: "1K" }), 0.02, "Nano Banana 2.1 1K");
  close(cost({ provider: "Suno Music", charged_cost: 1.5 }), 0.06, "Suno song");
  close(cost({ provider: "Text to Dialogue", charged_cost: 1 }), 0.08, "Speech 1,000 characters");
  close(cost({ provider: "heygen-avatar-iv", model: "avatar_v", charged_cost: 7 }), 0.385, "Avatar IV 10 s");
  assert.equal(runCost({ provider: "veo3.1lite", model: "veo3_lite", status: "failed", charged_cost: 2 }).usd, 0, "failed runs cost nothing");
});

test("payments: Dodo minus tax and its standard fee, YooMoney at the owner's rate and fee", () => {
  const dodo = paymentUsd({ provider: "dodopayments", status: "succeeded", currency: "USD", amount_cents: 1099,
    financial: { settlement_amount: 1099, settlement_currency: "USD", settlement_tax: 100, card_issuing_country: "AM" } });
  close(dodo.gross, 10.99, "gross"); close(dodo.tax, 1, "tax"); close(dodo.fees, 10.99 * 0.055 + 0.4, "fee"); close(dodo.net, 10.99 - 1 - (10.99 * 0.055 + 0.4), "net");
  const ym = paymentUsd({ provider: "yoomoney", status: "succeeded", currency: "RUB", amount_cents: 75000 }, { fx: { RUB: 0.0125 }, fees: { yoomoney_pct: 3 } });
  close(ym.gross, 9.375, "YooMoney gross"); close(ym.net, 9.375 * 0.97, "YooMoney net");
  assert.equal(paymentUsd({ provider: "yoomoney", status: "succeeded", currency: "RUB", amount_cents: 75000 }, {}).known, false, "no RUB rate → not counted");
});

test("a day's profit, free-user cost, unused credits and what new buyers did before paying", () => {
  const buyer = "11111111-1111-4111-8111-111111111111", free = "22222222-2222-4222-8222-222222222222";
  const snapshot = {
    payments: [{ id: 1, transaction_id: "t1", uid: buyer, credits: 90, status: "succeeded", provider: "dodopayments", paid_at: "2026-11-02T10:00:00Z", currency: "USD", amount_cents: 999,
      financial: { settlement_amount: 999, settlement_currency: "USD", settlement_tax: 0, card_issuing_country: "US" } }],
    generations: [
      { user_id: buyer, created_at: "2026-11-02T09:00:00Z", provider: "Grok", model: "grok-video", status: "done", charged_cost: 1.8 },
      { user_id: buyer, created_at: "2026-11-02T11:00:00Z", provider: "Wan 3.0", model: "wan3.0-video", resolution: "720p", duration: 10, input_seconds: 0, status: "done", charged_cost: 10 },
      { user_id: free, created_at: "2026-11-02T12:00:00Z", provider: "veo3.1lite", model: "veo3_lite", resolution: "720p", status: "done", charged_cost: 2 },
      { user_id: free, created_at: "2026-11-02T12:05:00Z", provider: "veo3.1lite", model: "veo3_lite", resolution: "720p", status: "failed", charged_cost: 2 },
      { user_id: OWNER_ID, created_at: "2026-11-02T13:00:00Z", provider: "Seedance 2.5", model: "doubao-seedance-2.5-face", resolution: "480p", duration: 10, input_seconds: 0, status: "done" },
    ],
    registrations: [{ day: "2026-11-02", n: 7 }],
    buyers: [{ user_id: buyer, email: "b@x.com", credits: 80, first_payment: "2026-11-02T10:00:00Z" }],
    purchase_journeys: [{ user_id: buyer, first_purchase: "2026-11-02T10:00:00Z", generations: [{ created_at: "2026-11-02T09:00:00Z", provider: "Grok", model: "grok-video", status: "done" }] }],
    expenses: [{ id: "e", name: "Supabase", amount_cents: 3000, currency: "USD", recurrence: "monthly", paid_on: "2026-11-01", starts_on: "2026-11-01", ends_on: "2026-11-30" }],
    settings: {},
  };
  const r = buildProfit(snapshot, { start: "2026-11-02", end: "2026-11-02" });
  const t = r.totals;
  close(t.net, 9.99 - (9.99 * 0.04 + 0.4), "money in (US card: 4% + $0.40)");
  close(t.cost_free, 0.15 + 0.135, "free users: the Grok run before buying and the free Veo run");
  close(t.cost_buyers, 0.58, "buyer: Wan after buying");
  close(t.cost_internal, 1.19, "owner's own Seedance run");
  close(t.expenses, 1, "$30 a month is $1 a day in November");
  // Profit follows the sale: 900 credits sold × cost per credit (too few buyer credits used to measure, so the
  // standard $0.0068), minus free users, the owner's own runs and the day's expenses. The buyer's Wan run is not
  // a cost again.
  close(t.cost_of_sold, 900 * 0.0068, "cost of the credits sold");
  // The buyer's Wan video (100 credits) really cost $0.58 against $0.68 at the average: a +$0.10 correction.
  close(t.correction, 100 * 0.0068 - 0.58, "correction for what the buyer really used");
  close(t.profit, t.net - 900 * 0.0068 + (100 * 0.0068 - 0.58) - (0.15 + 0.135) - 1.19 - 1, "profit");
  assert.equal(t.signups, 7); assert.equal(t.generators, 2); assert.equal(t.generations, 4); assert.equal(t.failed, 1);
  assert.equal(t.new_buyers, 1); assert.equal(t.credits_sold, 900); assert.equal(t.credits_used_buyers, 100);
  assert.equal(t.unused_credits_now, 800, "800 of the 900 bought credits are still unused");
  close(t.unused_value_now, (800 * (9.99 - (9.99 * 0.04 + 0.4))) / 900, "unused credits are worth what the buyer paid for them");
  assert.deepEqual(r.last_models, [{ model: "Grok Video", count: 1 }]);
  assert.equal(r.journeys[0].hours_to_buy, 1);
});

test("UTC days like Dodo, the owner's own purchases and the measured cost per credit", () => {
  const buyer = "33333333-3333-4333-8333-333333333333";
  const usd = (cents) => ({ settlement_amount: cents, settlement_currency: "USD", settlement_tax: 0, card_issuing_country: "US" });
  const snapshot = {
    payments: [
      // Saman's real case: 23:34 UTC on 1 Nov is 03:34 on 2 Nov in Armenia, but Dodo counts it on 1 Nov.
      { id: 0, transaction_id: "utc-yesterday", uid: buyer, credits: 200, status: "succeeded", provider: "dodopayments", paid_at: "2026-11-01T23:34:00Z", currency: "USD", amount_cents: 1999, financial: usd(1999) },
      { id: 1, transaction_id: "late", uid: buyer, credits: 200, status: "succeeded", provider: "dodopayments", paid_at: "2026-11-02T00:30:00Z", currency: "USD", amount_cents: 1999, financial: usd(1999) },
      { id: 2, transaction_id: "own", uid: OWNER_ID, credits: 90, status: "succeeded", provider: "dodopayments", paid_at: "2026-11-02T08:00:00Z", currency: "USD", amount_cents: 999, financial: usd(999) },
      // Saved without settlement or tax: completed from Dodo's own record.
      { id: 3, transaction_id: "bare", uid: buyer, credits: 90, status: "succeeded", provider: "dodopayments", paid_at: "2026-11-02T09:00:00Z", currency: "EUR", amount_cents: 900, financial: {},
        dodo: { total_amount: 900, currency: "EUR", tax: 0, settlement_amount: 1050, settlement_currency: "USD", settlement_tax: 0, card_issuing_country: "US" } },
    ],
    generations: Array.from({ length: 20 }, (_, i) => ({ user_id: buyer, created_at: "2026-11-02T01:00:00Z", provider: "Wan 3.0", model: "wan3.0-video", resolution: "720p", duration: 10, input_seconds: 0, status: "done", charged_cost: 10, run_id: `r${i}` })),
    buyers: [{ user_id: buyer, credits: 0 }], purchase_journeys: [], expenses: [], settings: {},
  };
  const r = buildProfit(snapshot, { start: "2026-11-02", end: "2026-11-02" });
  const t = r.totals;
  assert.equal(t.payments, 3, "2 Nov (UTC): the early payment, the owner's own and the completed one, not the 23:34 one of 1 Nov");
  close(t.gross, 19.99 + 9.99 + 10.5, "gross as in Dodo");
  // 20 Wan runs × 100 credits = 2,000 credits for $11.60 → $0.0058 a credit.
  close(t.cost_per_credit, 0.0058, "measured cost per credit");
  close(t.cost_of_sold, (2000 + 900) * 0.0058, "cost of the credits sold (the owner's own purchase is not counted twice)");
  close(t.cost_buyers, 11.6, "provider spending is still shown");
  assert.equal(t.new_buyers + t.repeat_buyers, 2, "the owner's own purchase is not a customer");
});

test("a buyer who spends on a thin-margin model lowers the profit of the day they spend, and their own profit", () => {
  const buyer = "44444444-4444-4444-8444-444444444444";
  const snapshot = {
    payments: [{ id: 1, transaction_id: "p", uid: buyer, credits: 510, status: "succeeded", provider: "dodopayments", paid_at: "2026-10-20T10:00:00Z", currency: "USD", amount_cents: 4999,
      financial: { settlement_amount: 4999, settlement_currency: "USD", settlement_tax: 0, card_issuing_country: "US" } }],
    // 10 Wan videos to measure the average ($0.0058 a credit), then on 2 Nov two Seedance 2.5 1080p videos.
    generations: [
      ...Array.from({ length: 10 }, (_, i) => ({ user_id: buyer, created_at: "2026-10-25T10:00:00Z", provider: "Wan 3.0", model: "wan3.0-video", resolution: "720p", duration: 10, input_seconds: 0, status: "done", charged_cost: 10, run_id: `w${i}` })),
      ...[1, 2].map((i) => ({ user_id: buyer, created_at: "2026-11-02T10:00:00Z", provider: "Seedance 2.5", model: "doubao-seedance-2.5-face", resolution: "1080p", duration: 10, input_seconds: 0, status: "done", charged_cost: 75.7, run_id: `s${i}` })),
    ],
    buyers: [{ user_id: buyer, email: "b@x.com", credits: 51 }], purchase_journeys: [], expenses: [], settings: {},
  };
  const r = buildProfit(snapshot, { start: "2026-11-02", end: "2026-11-02" });
  const perCredit = (5.8 + 12.86) / 2514; // the 30-day average includes these runs: $18.66 for 2,514 credits
  close(r.totals.cost_per_credit, perCredit, "average cost per credit");
  close(r.totals.correction, 1514 * perCredit - 12.86, "the day they spend shows what the expensive model really cost");
  assert.ok(r.totals.correction < 0, "a thin-margin model is a negative correction");
  close(r.totals.profit, r.totals.correction, "no sales that day: only the correction");
  const b = r.buyers[0];
  const paid = 49.99 - (49.99 * 0.04 + 0.4);
  assert.equal(b.used_credits, 2514); assert.equal(b.unused, 510);
  close(b.used_cost, 5.8 + 12.86, "what their generations really cost");
  close(b.earned, 2514 * (paid / 5100) - (5.8 + 12.86), "profit from the credits they used");
  close(b.expected, 510 * (paid / 5100 - perCredit), "expected profit on the credits left");
});

test("euro and pound Dodo payments count at Dodo's dollar value (pack price + tax), and an empty tax is no tax", () => {
  // Real October payments: €21.62 incl. €3.75 tax for the $19.99 pack is $24.19 in Dodo; £8.95 incl. £1.49 tax
  // for $9.99 is $11.99; €88.98 with an empty tax for $99.99 is $99.99; a $9.99 with an empty tax is $9.99.
  const pay = (credits, amount, tax, currency, country = "LT") => ({ provider: "dodopayments", status: "succeeded", credits, currency, amount_cents: amount,
    financial: { settlement_amount: amount, settlement_tax: tax, settlement_currency: currency, card_issuing_country: country } });
  close(paymentUsd(pay(200, 2162, 375, "EUR")).gross, 24.19, "EUR 19.99 pack");
  close(paymentUsd(pay(200, 2162, 375, "EUR")).tax, 4.20, "its tax in dollars");
  close(paymentUsd(pay(90, 895, 149, "GBP", "GB")).gross, 11.99, "GBP 9.99 pack");
  close(paymentUsd(pay(1100, 8898, null, "EUR")).gross, 99.99, "EUR 99.99 pack, empty tax");
  const usd = paymentUsd(pay(90, 999, null, "USD", "US"));
  assert.equal(usd.known, true, "a dollar payment with an empty tax still counts");
  close(usd.gross, 9.99, "USD 9.99");
});

test("YooMoney: its own paid and received rubles at the day's rate, the real fee, even for rows saved as USD 9.90", () => {
  // Real October row: saved as "USD 990", but YooMoney's record says the buyer paid 750 ₽ and Hansora got 727.50 ₽.
  const row = { provider: "yoomoney", status: "succeeded", credits: 100, currency: "USD", amount_cents: 990, paid_at: "2026-10-23T22:46:11Z",
    yoomoney: { paid: "750.00", received: "727.50" } };
  const u = paymentUsd(row, { rubRates: { "2026-10-23": 0.0123 } });
  assert.equal(u.currency, "RUB");
  close(u.gross, 750 * 0.0123, "what the buyer paid");
  close(u.fees, 22.5 * 0.0123, "YooMoney kept 3%");
  close(u.net, 727.5 * 0.0123, "what Hansora received");
  // No rate for that day: another day's rate of the period is used rather than leaving the payment out.
  close(paymentUsd(row, { rubRates: { "2026-10-24": 0.0125 } }).net, 727.5 * 0.0125, "the period's rate");
  assert.equal(paymentUsd(row, {}).known, false, "no rate at all: reported, not guessed");
});
