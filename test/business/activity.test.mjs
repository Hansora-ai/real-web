import test from "node:test";
import assert from "node:assert/strict";
import { buildActivity } from "../../lib/business/activity.mjs";

test("traffic: live counts, today against yesterday at the same time, hours, sources, ratings and each person", () => {
  const now = Date.parse("2026-11-02T10:30:00Z");
  const a = "aaaaaaaa-0000-4000-8000-000000000001", b = "bbbbbbbb-0000-4000-8000-000000000002";
  const gen = (user, at, extra = {}) => ({ user_id: user, created_at: at, provider: "Grok", model: "grok-video", status: "done", charged_cost: 1.8, surface: "ChatGPT", ...extra });
  const snapshot = {
    generations: [
      gen(a, "2026-11-02T10:20:00Z"), gen(a, "2026-11-02T09:00:00Z", { status: "failed" }),
      gen(b, "2026-11-02T08:00:00Z", { surface: "Website / other", provider: "veo3.1lite", model: "veo3_lite" }),
      gen(b, "2026-11-01T09:00:00Z"), gen(b, "2026-11-01T20:00:00Z"),
    ],
    signup_times: ["2026-11-02T10:05:00Z", "2026-11-01T07:00:00Z"],
    signup_at: { [a]: "2026-11-02T10:05:00Z" },
    emails: { [a]: "a@x.com", [b]: "b@x.com" },
    payments: [{ uid: b, status: "succeeded", paid_at: "2026-11-02T08:30:00Z", usd: { known: true, gross: 9.99 } }],
    ratings: [{ user_id: a, provider: "Grok", model: "grok-video", rating: -1, reasons: ["Low quality"], comment: "blurry", updated_at: "2026-11-02T10:25:00Z" }],
  };
  const r = buildActivity(snapshot, { start: "2026-11-02", end: "2026-11-02", now });
  assert.equal(r.live.last_signup_at, "2026-11-02T10:05:00Z");
  assert.equal(r.live.last_generation_at, "2026-11-02T10:20:00Z");
  assert.equal(r.live.active_15m, 1);
  assert.equal(r.live.signups_60m, 1);
  assert.deepEqual([r.compare.today.generations, r.compare.today.people, r.compare.today.signups, r.compare.today.sales], [3, 2, 1, 1]);
  assert.deepEqual([r.compare.yesterday.generations, r.compare.yesterday.signups], [1, 1], "yesterday until 10:30 only");
  assert.equal(r.hours[10].generations, 1);
  assert.deepEqual(r.surfaces.chatgpt, { people: 1, generations: 2 });
  assert.equal(r.ratings.down, 1);
  assert.equal(r.ratings.recent[0].comment, "blurry");
  const pa = r.users.find((u) => u.user_id === a), pb = r.users.find((u) => u.user_id === b);
  assert.deepEqual([pa.email, pa.generations, pa.failed, pa.dislikes, pa.comment, pa.purchases], ["a@x.com", 2, 1, 1, "blurry", 0]);
  assert.deepEqual([pb.purchases, pb.paid, pb.models[0]], [1, 9.99, "Veo 3.1 Lite"]);
  assert.equal(r.users[0].user_id, a, "most recently active first");
});
