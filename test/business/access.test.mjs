import test from "node:test";
import assert from "node:assert/strict";
import { requireOwner, OWNER_ID, json } from "../../lib/business/access.mjs";
const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  },
  event = { headers: { authorization: "Bearer user-token" } };
test("denies anonymous and non-owner requests before reading any financial data", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        id: "other-user",
        user_metadata: { id: OWNER_ID, role: "owner" },
      }),
    };
  };
  await assert.rejects(
    requireOwner({ headers: {} }, { fetcher, env }),
    (e) => e.status === 401,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    requireOwner(event, { fetcher, env }),
    (e) => e.status === 403,
  );
  assert.equal(calls, 1);
});
test("checks live Auth identity and permits only the owner UUID", async () => {
  let used;
  const auth = await requireOwner(event, {
    env,
    fetcher: async (url, options) => {
      used = { url, options };
      return { ok: true, json: async () => ({ id: OWNER_ID }) };
    },
  });
  assert.equal(auth.user.id, OWNER_ID);
  assert.equal(used.options.headers.Authorization, "Bearer user-token");
  assert.ok(used.url.endsWith("/auth/v1/user"));
});
test("private replies cannot be cached or read with wildcard CORS", () => {
  const response = json(200, { ok: true });
  assert.match(response.headers["Cache-Control"], /no-store/);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(response.headers.Vary, "Authorization");
});
