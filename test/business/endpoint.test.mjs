import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "../../netlify/functions/business-dashboard.mjs";
import { OWNER_ID } from "../../lib/business/access.mjs";
const env = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
const original = globalThis.fetch;
const event = (httpMethod = "GET", body) => ({
  httpMethod,
  headers: { authorization: "Bearer session" },
  queryStringParameters: { start: "2026-10-30", end: "2026-10-30" },
  body: JSON.stringify(body),
});
const snapshot = {
  payments: [],
  generations: [],
  buyers: [],
  expenses: [],
  registrations: [],
  refunds: [],
  settings: {},
};
function mock(owner = OWNER_ID, reply = snapshot) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/auth/v1/user") ? { id: owner } : reply),
    };
  };
  return calls;
}
test.afterEach(() => {
  globalThis.fetch = original;
});
test.after(() => {
  if (env.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
});
test("non-owner cannot read a report or write an expense", async () => {
  for (const method of ["GET", "POST"]) {
    const calls = mock("customer");
    const result = await handler(event(method, { action: "save_expense" }));
    assert.equal(result.statusCode, 403);
    assert.equal(calls.length, 1);
  }
});
test("valid owner receives private aggregates through the service-only RPC", async () => {
  const calls = mock();
  const result = await handler(event());
  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /rpc\/business_dashboard_snapshot$/);
  // 30 days back, so the real cost of one credit can be measured; sign-ups by UTC day, like Dodo.
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_start: "2026-09-30", p_end: "2026-10-30" });
  assert.match(calls[2].url, /profiles\?select=a&a=gte\.2026-10-30T00:00:00Z&a=lt\.2026-10-31T00:00:00Z/);
  assert.equal(JSON.parse(result.body).totals.profit, 0);
  assert.ok(!result.body.includes("server-secret"));
});
test("invalid ranges fail before any financial query", async () => {
  const calls = mock();
  const result = await handler({
    ...event(),
    queryStringParameters: { start: "2025-01-01", end: "2026-10-30" },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(calls.length, 1);
});
test("expense writes use the fixed owner, exact integer cents and a scoped update", async () => {
  const calls = mock(OWNER_ID, [
    { id: "12345678-1234-4234-8234-123456789abc" },
  ]);
  const result = await handler(
    event("POST", {
      action: "save_expense",
      id: "12345678-1234-4234-8234-123456789abc",
      expense: {
        name: "Blogger",
        amount: "200.00",
        paid_on: "2026-10-30",
        starts_on: "2026-10-30",
        ends_on: "2026-10-30",
        owner_user_id: "attacker",
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.match(calls[1].url, new RegExp(`owner_user_id=eq.${OWNER_ID}`));
  const sent = JSON.parse(calls[1].options.body);
  assert.equal(sent.owner_user_id, OWNER_ID);
  assert.equal(sent.amount_cents, 20000);
});
test("archive is reversible and both actions remain owner-scoped", async () => {
  for (const action of ["archive_expense", "restore_expense"]) {
    const calls = mock(OWNER_ID, [{}]);
    const result = await handler(
      event("POST", { action, id: "12345678-1234-4234-8234-123456789abc" }),
    );
    assert.equal(result.statusCode, 200);
    assert.ok(calls[1].url.includes(OWNER_ID));
    const sent = JSON.parse(calls[1].options.body);
    assert.equal(sent.archived_at === null, action === "restore_expense");
  }
});
