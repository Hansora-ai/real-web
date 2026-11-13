import test from "node:test";
import assert from "node:assert/strict";
import { alertText, checkProviderBalances, levelOf, providers, shouldAlert } from "../../lib/business/provider-balance.mjs";

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const env = { KIE_API_KEY: "k", REAPI_API_KEY: "r", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "s" };

function world({ kie = 5000, reapi = 50000, stored = [], kieDown = false } = {}) {
  const saved = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("api.kie.ai/api/v1/chat/credit")) return kieDown ? reply({ code: 500, msg: "error" }, 500) : reply({ code: 200, msg: "success", data: kie });
    if (href.includes("reapi.ai/api/v1/balance")) return reply({ balance: reapi });
    if (href.includes("/rest/v1/chatgpt_events") && options.method === "POST") { saved.push(JSON.parse(options.body)); return reply({}); }
    if (href.includes("/rest/v1/chatgpt_events")) return reply(stored);
    throw new Error(`unexpected ${href}`);
  };
  return { fetchImpl, saved };
}

test("levels: ok, low below the level, empty below a fifth of it", () => {
  assert.equal(levelOf(12000, 10000), "ok");
  assert.equal(levelOf(9000, 10000), "low");
  assert.equal(levelOf(1500, 10000), "empty");
  assert.equal(shouldAlert(undefined, "ok"), false);
  assert.equal(shouldAlert(undefined, "low"), true);
  assert.equal(shouldAlert("low", "low"), false);
  assert.equal(shouldAlert("low", "empty"), true);
  assert.equal(shouldAlert("empty", "low"), false, "a small top-up that is still low does not alert again");
  assert.equal(shouldAlert("empty", "ok"), true);
  const reapi = providers(env).find((p) => p.id === "reapi");
  assert.equal(alertText(reapi, "low", 7420), "⚠️ reAPI balance is low: $7.42 (7,420 credits) left. Top up soon to avoid failed generations.");
  assert.match(alertText(reapi, "empty", 1200), /^🚨 reAPI is almost empty: \$1\.20/);
});

test("the owner is told once when a balance runs low, not every 10 minutes, and once when it is topped up", async () => {
  const sent = [];
  const send = async (text) => { sent.push(text); return { sent: true }; };
  const low = world({ reapi: 7420 });
  let results = await checkProviderBalances({ env, fetchImpl: low.fetchImpl, send });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /reAPI balance is low: \$7\.42/);
  assert.deepEqual(low.saved.map((row) => [row.tool, row.model_id, row.outcome]), [["provider_balance", "reapi", "low"]]);
  assert.deepEqual(results.map((r) => [r.provider, r.level]), [["kie", "ok"], ["reapi", "low"]]);

  // Ten minutes later, still low: nothing new.
  const still = world({ reapi: 7000, stored: [{ model_id: "reapi", outcome: "low" }] });
  await checkProviderBalances({ env, fetchImpl: still.fetchImpl, send });
  assert.equal(sent.length, 1);

  // Topped up: one confirmation.
  const topped = world({ reapi: 60000, stored: [{ model_id: "reapi", outcome: "low" }] });
  await checkProviderBalances({ env, fetchImpl: topped.fetchImpl, send });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /^✅ reAPI topped up: \$60\.00/);
});

test("a balance that cannot be read never alerts", async () => {
  const sent = [];
  const down = world({ kieDown: true, reapi: 50000 });
  const results = await checkProviderBalances({ env, fetchImpl: down.fetchImpl, send: async (text) => { sent.push(text); } });
  assert.equal(sent.length, 0);
  assert.match(results.find((r) => r.provider === "kie").error, /^kie_balance_500/);
});

test("the first generation that fails because Kie or reAPI has no credits alerts the owner at once, then not again for 30 minutes", async () => {
  const { alertProviderError, providerOutOfCredits } = await import("../../lib/business/provider-balance.mjs");
  assert.equal(providerOutOfCredits("Insufficient credits. Required: 8005"), "reapi");
  assert.equal(providerOutOfCredits("Credits insufficient : Your current balance isn’t enough to run this request. Please top up to continue."), "kie");
  assert.equal(providerOutOfCredits("Provider temporarily unavailable. Nothing was charged."), "kie");
  // The user's own balance is not the provider's.
  assert.equal(providerOutOfCredits('{"ok":false,"error":"not_enough_credits","credits":0.3,"need":0.5}'), null);
  assert.equal(providerOutOfCredits("Not enough credits."), null);
  assert.equal(providerOutOfCredits("Request blocked: The input content was flagged"), null);

  const sent = [];
  const send = async (text) => { sent.push(text); };
  const first = world({ reapi: 1200 });
  const result = await alertProviderError('{"ok":false,"error":"Insufficient credits. Required: 8005"}', { env, fetchImpl: first.fetchImpl, send });
  assert.equal(result.alerted, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], '🚨 reAPI has run out of credits: a customer\'s generation just failed ("Insufficient credits. Required: 8005"). Balance now: $1.20 (1,200 credits). Top up now.');
  assert.deepEqual(first.saved.map((row) => [row.model_id, row.outcome]), [["reapi", "empty"]]);

  // Another failure a minute later: already told.
  const again = world({ reapi: 1200, stored: [{ id: "e1" }] });
  assert.equal((await alertProviderError("Insufficient credits. Required: 1728", { env, fetchImpl: again.fetchImpl, send })).alerted, false);
  assert.equal(sent.length, 1);
  // Not a provider problem: nothing at all.
  assert.equal((await alertProviderError("Request blocked: content", { env, fetchImpl: first.fetchImpl, send })).alerted, false);
  assert.equal(sent.length, 1);
});
