import test from "node:test";
import assert from "node:assert/strict";
import { buildAudience } from "../../lib/business/audience.mjs";
import { INTERNAL_IDS } from "../../lib/business/access.mjs";
const range = { start: "2026-10-30", end: "2026-10-30" };
const first = "2026-10-30T10:00:00Z";
const job = (
  id,
  provider,
  status = "done",
  created_at = "2026-10-01T01:00:00Z",
) => ({ id, provider, status, created_at });
const buyer = (user_id, generations = [], first_purchase = first) => ({
  user_id,
  generations,
  first_purchase,
});
test("looks before the reporting window and strictly before purchase; overlapping models count each buyer once", () => {
  const s = {
    purchase_journeys: [
      buyer("a", [
        job("1", "Grok"),
        job("2", "Grok"),
        job("3", "Veo", "done", "2026-10-29T01:00:00Z"),
        job("4", "Post purchase", "done", first),
      ]),
    ],
  };
  const b = buildAudience(s, range).before_purchase;
  assert.equal(b.buyers, 1);
  assert.equal(b.with_success, 1);
  assert.deepEqual(b.groups, [{ name: "Veo", buyers: 1 }]);
  assert.equal(b.models.find((m) => m.name === "Grok").buyers, 1);
  assert.equal(b.models.find((m) => m.name === "Grok").attempts, 2);
  assert.equal(b.models.length, 2);
});
test("exclusive no-record, failed-only and unresolved categories reconcile to the cohort", () => {
  const b = buildAudience(
    {
      purchase_journeys: [
        buyer("a"),
        buyer("b", [job("b", "Grok", "failed")]),
        buyer("c", [job("c", "Grok", "processing")]),
        buyer("old", [], "2026-10-29T01:00:00Z"),
        buyer(INTERNAL_IDS[0]),
      ],
    },
    range,
  ).before_purchase;
  assert.equal(b.buyers, 3);
  assert.equal(b.no_history, 1);
  assert.equal(b.failed_only, 1);
  assert.equal(
    b.groups.reduce((a, r) => a + r.buyers, 0),
    3,
  );
});
test("duplicate run snapshots and duplicate buyer records do not inflate counts", () => {
  const a = job("1", "Grok", "failed");
  a.run_id = "run";
  const b = {
    ...job("2", "Grok", "done", "2026-10-02T01:00:00Z"),
    run_id: "run",
  };
  const r = buildAudience(
    { purchase_journeys: [buyer("a", [a, b]), buyer("a", [a, b])] },
    range,
  ).before_purchase;
  assert.equal(r.buyers, 1);
  assert.equal(r.models[0].attempts, 1);
  assert.equal(r.models[0].successful, 1);
});
test("ratings use latest saved vote update, exclude internal accounts, and include comments without a generation join", () => {
  const rating = (run_id, rating, over = {}) => ({
    run_id,
    rating,
    provider: "Grok",
    user_id: "a",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: first,
    ...over,
  });
  const f = buildAudience(
    {
      ratings: [
        rating("r", 1),
        rating("r", -1, {
          updated_at: "2026-10-30T11:00:00Z",
          comment: "<script>test</script>",
          reasons: ["motion"],
        }),
        rating("x", 1),
        rating("i", -1, { user_id: INTERNAL_IDS[0] }),
        rating("old", 1, { updated_at: "2026-10-29T01:00:00Z" }),
      ],
    },
    range,
  ).feedback;
  assert.equal(f.total, 2);
  assert.equal(f.likes, 1);
  assert.equal(f.dislikes, 1);
  assert.equal(f.like_rate, 0.5);
  assert.equal(f.comments, 1);
  assert.equal(f.ratings[0].comment, "<script>test</script>");
});
test("Armenia midnight determines cohort inclusion; missing data is distinguishable from zero", () => {
  const b = buildAudience(
    {
      purchase_journeys: [
        buyer("yes", [], "2026-10-29T21:00:00Z"),
        buyer("no", [], "2026-10-30T21:00:00Z"),
      ],
      ratings: [],
    },
    range,
  );
  assert.equal(b.before_purchase.buyers, 1);
  assert.equal(b.feedback.like_rate, null);
  assert.equal(b.feedback.available, true);
  assert.equal(buildAudience({}, range).feedback.available, false);
});
