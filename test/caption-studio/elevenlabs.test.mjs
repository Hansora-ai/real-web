import { test } from "node:test";
import assert from "node:assert/strict";
import { createCaptionToken } from "../../lib/caption-studio/elevenlabs.mjs";
import handler from "../../netlify/functions/caption-studio-token.mjs";
test("only single-use tokens cross the server boundary", async () => {
  let request;
  const result = await createCaptionToken({
    apiKey: "test-secret",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ token: "one-use" });
    },
  });
  assert.equal(
    request.url,
    "https://api.elevenlabs.io/v1/single-use-token/batch_scribe",
  );
  assert.equal(request.options.headers["xi-api-key"], "test-secret");
  assert.deepEqual(result, { token: "one-use" });
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});
test("missing or rejected key returns actionable errors without secrets", async () => {
  await assert.rejects(createCaptionToken({}), (e) => e.status === 503);
  await assert.rejects(
    createCaptionToken({
      apiKey: "test-secret",
      fetchImpl: async () => new Response("", { status: 401 }),
    }),
    (e) => e.status === 502 && !e.message.includes("test-secret"),
  );
});
test("Netlify endpoint rejects unauthenticated requests before contacting ElevenLabs", async () => {
  const response = await handler(
    new Request("https://example.com/.netlify/functions/caption-studio-token", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Sign in/);
});
test("Netlify endpoint requires POST", async () =>
  assert.equal(
    (await handler(new Request("https://example.com/token"))).status,
    405,
  ));

test("caption transcription accepts the existing Netlify key names", async () => {
  const { elevenLabsKey } = await import(
    "../../lib/caption-studio/elevenlabs.mjs"
  );
  assert.equal(
    elevenLabsKey({
      Elevan_labs_api1: " legacy-key ",
      ELEVENLABS_API_KEY: "modern-key",
    }),
    "legacy-key",
  );
  assert.equal(elevenLabsKey({ Elevan_labs_api: "shared-key" }), "shared-key");
  assert.equal(
    elevenLabsKey({ ELEVENLABS_API_KEY: "modern-key" }),
    "modern-key",
  );
  assert.equal(elevenLabsKey({}), "");
});
