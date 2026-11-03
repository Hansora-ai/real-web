import { INTERNAL_IDS } from "./access.mjs";
const excluded = new Set(INTERNAL_IDS);
const success = (g) =>
  ["done", "ready", "completed", "success", "succeeded"].includes(
    String(g.status).toLowerCase(),
  );
const failed = (g) =>
  ["failed", "error", "canceled", "cancelled", "rejected"].includes(
    String(g.status).toLowerCase(),
  );
const day = (v) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(v));
const inRange = (v, r) =>
  v && Number.isFinite(Date.parse(v)) && day(v) >= r.start && day(v) <= r.end;
const label = (g) => g.provider || g.model || "Unknown model";
export function buildAudience(snapshot, range) {
  const groups = new Map(),
    models = new Map(),
    seenBuyers = new Set();
  let buyers = 0,
    noHistory = 0,
    withSuccess = 0,
    failedOnly = 0;
  const journeys = [];
  for (const b of snapshot.purchase_journeys || []) {
    if (
      !b.user_id ||
      excluded.has(b.user_id) ||
      seenBuyers.has(b.user_id) ||
      !inRange(b.first_purchase, range)
    )
      continue;
    seenBuyers.add(b.user_id);
    buyers++;
    const unique = new Map();
    for (const g of b.generations || []) {
      if (!(Date.parse(g.created_at) < Date.parse(b.first_purchase))) continue;
      const key = g.run_id || g.id;
      if (!key) continue;
      const old = unique.get(key);
      if (!old || Date.parse(g.created_at) > Date.parse(old.created_at))
        unique.set(key, g);
    }
    const jobs = [...unique.values()].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    const done = jobs.filter(success),
      bad = jobs.filter(failed);
    let group;
    if (!jobs.length) {
      noHistory++;
      group = "No generation recorded";
    } else if (done.length) {
      withSuccess++;
      group = label(done.at(-1));
    } else if (bad.length === jobs.length) {
      failedOnly++;
      group = "Failed attempts only";
    } else group = "Attempts recorded · no confirmed success";
    groups.set(group, (groups.get(group) || 0) + 1);
    const used = new Set();
    for (const g of jobs) {
      const name = label(g),
        r = models.get(name) || {
          name,
          buyers: 0,
          attempts: 0,
          successful: 0,
          failed: 0,
        };
      r.attempts++;
      if (success(g)) r.successful++;
      if (failed(g)) r.failed++;
      if (!used.has(name)) {
        r.buyers++;
        used.add(name);
      }
      models.set(name, r);
    }
    journeys.push({
      user_id: b.user_id,
      first_purchase: b.first_purchase,
      attempts: jobs.length,
      successful: done.length,
      failed: bad.length,
      last_success: done.length ? label(done.at(-1)) : null,
      group,
    });
  }
  const ratingsByRun = new Map();
  for (const r of snapshot.ratings || []) {
    if (
      excluded.has(r.user_id) ||
      ![1, -1].includes(Number(r.rating)) ||
      !inRange(r.updated_at || r.created_at, range)
    )
      continue;
    const old = ratingsByRun.get(r.run_id);
    if (
      !old ||
      Date.parse(r.updated_at || r.created_at) >
        Date.parse(old.updated_at || old.created_at)
    )
      ratingsByRun.set(r.run_id, r);
  }
  const ratings = [...ratingsByRun.values()].sort(
    (a, b) =>
      Date.parse(b.updated_at || b.created_at) -
      Date.parse(a.updated_at || a.created_at),
  );
  const ratingModels = new Map();
  let likes = 0,
    dislikes = 0,
    comments = 0;
  for (const r of ratings) {
    const name = label(r),
      m = ratingModels.get(name) || { name, likes: 0, dislikes: 0 };
    if (Number(r.rating) === 1) {
      likes++;
      m.likes++;
    } else {
      dislikes++;
      m.dislikes++;
    }
    if (String(r.comment || "").trim()) comments++;
    ratingModels.set(name, m);
  }
  return {
    before_purchase: {
      available: Array.isArray(snapshot.purchase_journeys),
      buyers,
      no_history: noHistory,
      with_success: withSuccess,
      failed_only: failedOnly,
      history_start: snapshot.generation_history_start || null,
      groups: [...groups]
        .map(([name, buyers]) => ({ name, buyers }))
        .sort((a, b) => b.buyers - a.buyers),
      models: [...models.values()].sort((a, b) => b.buyers - a.buyers),
      journeys,
    },
    feedback: {
      available: Array.isArray(snapshot.ratings),
      likes,
      dislikes,
      comments,
      total: ratings.length,
      like_rate: ratings.length ? likes / ratings.length : null,
      models: [...ratingModels.values()].sort(
        (a, b) => b.likes + b.dislikes - (a.likes + a.dislikes),
      ),
      ratings,
    },
  };
}
