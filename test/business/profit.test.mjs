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
  close(t.profit, t.net - (0.15 + 0.135 + 0.58 + 1.19) - 1, "profit");
  assert.equal(t.signups, 7); assert.equal(t.generators, 2); assert.equal(t.generations, 4); assert.equal(t.failed, 1);
  assert.equal(t.new_buyers, 1); assert.equal(t.credits_sold, 900); assert.equal(t.credits_used_buyers, 100);
  assert.equal(t.unused_credits_now, 800, "800 of the 900 bought credits are still unused");
  close(t.unused_value_now, (800 * (9.99 - (9.99 * 0.04 + 0.4))) / 900, "unused credits are worth what the buyer paid for them");
  assert.deepEqual(r.last_models, [{ model: "Grok Video", count: 1 }]);
  assert.equal(r.journeys[0].hours_to_buy, 1);
});
