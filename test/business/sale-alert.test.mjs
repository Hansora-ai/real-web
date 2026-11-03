import test from "node:test";
import assert from "node:assert/strict";
import { notifySale, saleMessage } from "../../lib/business/sale-alert.mjs";

const now = Date.parse("2026-11-01T18:00:00Z");

test("the sale message says what was paid, by whom, and whether it is their first purchase", () => {
  assert.equal(
    saleMessage({ provider: "dodo", amountCents: 1999, currency: "USD", credits: 200 }, { email: "a@b.com", previousPurchases: 0, signedUpAt: "2026-11-01T16:00:00Z", chatgpt: true }, now),
    "💰 $19.99 · 2,000 credits · Dodo\na@b.com\nfirst purchase · signed up 2 h ago · uses ChatGPT"
  );
  assert.equal(
    saleMessage({ provider: "yoomoney", amountCents: 75000, currency: "643", credits: 90 }, { previousPurchases: 2, chatgpt: false }, now),
    "💰 750 ₽ · 900 credits · YooMoney\npurchase #3 · website"
  );
  assert.equal(saleMessage({ provider: "dodo", amountCents: 999, currency: "EUR", credits: 90 }, {}, now), "💰 €9.99 · 900 credits · Dodo");
  assert.equal(saleMessage({ provider: "dodo", amountCents: 999, currency: "USD", credits: 90 }, { signedUpAt: "2026-11-02T00:00:00Z" }, now), "💰 $9.99 · 900 credits · Dodo");
});

test("nothing is sent without the settings, or for the owner's own payments, and Telegram failures never throw", async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    delete process.env.SALES_TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = "t";
    globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("[]", { status: 200 }); };
    assert.deepEqual(await notifySale({ uid: "u1", provider: "dodo", amountCents: 999, currency: "USD", credits: 90 }, { supabaseUrl: "" }), { sent: false });
    process.env.SALES_TELEGRAM_CHAT_ID = "42";
    assert.deepEqual(await notifySale({ uid: "45c5cfc7-090e-491f-a304-05f863bbdf85", provider: "dodo", amountCents: 999, currency: "USD", credits: 90 }, { supabaseUrl: "" }), { sent: false });
    assert.equal(calls.length, 0);

    let body = null;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("/rest/v1/profiles")) return new Response(JSON.stringify([{ email: "x@y.com", a: new Date(Date.now() - 30 * 60000).toISOString() }]), { status: 200 });
      if (String(url).includes("/rest/v1/")) return new Response("[]", { status: 200 });
      body = JSON.parse(options.body);
      return new Response("{}", { status: 200 });
    };
    assert.deepEqual(await notifySale({ uid: "u1", transactionId: "pay_1", provider: "dodo", amountCents: 999, currency: "USD", credits: 90 }, { supabaseUrl: "https://db.test", serviceKey: "k" }), { sent: true });
    assert.equal(body.chat_id, "42");
    assert.match(body.text, /^💰 \$9\.99 · 900 credits · Dodo\nx@y\.com\nfirst purchase · signed up \d+ min ago · website$/);

    globalThis.fetch = async () => { throw new Error("down"); };
    assert.deepEqual(await notifySale({ uid: "u1", provider: "dodo", amountCents: 999, currency: "USD", credits: 90 }, { supabaseUrl: "" }), { sent: false });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
  }
});
