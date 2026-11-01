// Traffic and activity for the owner page: what is happening right now, whether today is normal compared with
// yesterday and the last 7 days at the same time of day, hour by hour, ChatGPT versus the website, and ratings.
import { INTERNAL_IDS } from "./access.mjs";
import { runCost } from "./costs.mjs";

const DONE = new Set(["done", "ready", "completed", "success", "succeeded"]);
const PAID = new Set(["succeeded", "paid", "refunded", "partially_refunded"]);
const HOUR = 36e5, DAY = 864e5;
const t = (v) => new Date(v).getTime();

// Counts between two moments.
function window(snapshot, from, to, internal) {
  const people = new Set(), surface = { chatgpt: new Set(), website: new Set() };
  let generations = 0, failed = 0, chatgptRuns = 0, websiteRuns = 0;
  for (const g of snapshot.generations || []) {
    const at = t(g.created_at);
    if (at < from || at >= to || internal.has(g.user_id)) continue;
    generations++;
    if (!(DONE.has(String(g.status || "").toLowerCase()) || g.has_result)) failed++;
    people.add(g.user_id);
    if (g.surface === "ChatGPT") { chatgptRuns++; surface.chatgpt.add(g.user_id); } else { websiteRuns++; surface.website.add(g.user_id); }
  }
  const signups = (snapshot.signup_times || []).filter((s) => t(s) >= from && t(s) < to).length;
  const sales = (snapshot.payments || []).filter((p) => PAID.has(p.status) && !internal.has(p.uid) && t(p.paid_at) >= from && t(p.paid_at) < to).length;
  return {
    signups, people: people.size, generations, failed, sales,
    chatgpt: { people: surface.chatgpt.size, generations: chatgptRuns },
    website: { people: surface.website.size, generations: websiteRuns },
  };
}

export function buildActivity(snapshot, { start, end, now = Date.now() }) {
  const internal = new Set(INTERNAL_IDS);
  const gens = (snapshot.generations || []).filter((g) => !internal.has(g.user_id));
  const latest = (list) => list.reduce((max, v) => (v && t(v) > (max ? t(max) : 0) ? v : max), null);
  const live = {
    now: new Date(now).toISOString(),
    last_signup_at: latest(snapshot.signup_times || []),
    last_generation_at: latest(gens.map((g) => g.created_at)),
    last_sale_at: latest((snapshot.payments || []).filter((p) => PAID.has(p.status) && !internal.has(p.uid)).map((p) => p.paid_at)),
    active_15m: new Set(gens.filter((g) => t(g.created_at) >= now - 15 * 60e3).map((g) => g.user_id)).size,
    active_60m: new Set(gens.filter((g) => t(g.created_at) >= now - HOUR).map((g) => g.user_id)).size,
    generations_60m: gens.filter((g) => t(g.created_at) >= now - HOUR).length,
    signups_60m: (snapshot.signup_times || []).filter((s) => t(s) >= now - HOUR).length,
  };

  // Today so far against the same hours of yesterday and of each of the 7 days before (UTC days, like Dodo).
  const today = Math.floor(now / DAY) * DAY, sofar = now - today;
  const todayCounts = window(snapshot, today, now, internal);
  const yesterday = window(snapshot, today - DAY, today - DAY + sofar, internal);
  const week = Array.from({ length: 7 }, (_, i) => window(snapshot, today - (i + 1) * DAY, today - (i + 1) * DAY + sofar, internal));
  const avg = (k) => Math.round((week.reduce((a, w) => a + w[k], 0) / 7) * 10) / 10;
  const compare = {
    today: todayCounts, yesterday,
    week_average: { signups: avg("signups"), people: avg("people"), generations: avg("generations"), failed: avg("failed"), sales: avg("sales") },
  };

  // Hour by hour for the last day of the period (the selected day when one day is shown).
  const dayStart = t(`${end}T00:00:00Z`);
  const hours = Array.from({ length: 24 }, (_, h) => ({ at: new Date(dayStart + h * HOUR).toISOString(), ...window(snapshot, dayStart + h * HOUR, dayStart + (h + 1) * HOUR, internal) }))
    .map(({ at, signups, people, generations, failed, sales }) => ({ at, signups, people, generations, failed, sales }));

  // The selected period: where people come from and what they think.
  const from = t(`${start}T00:00:00Z`), to = dayStart + DAY;
  const period = window(snapshot, from, to, internal);
  const ratings = (snapshot.ratings || []).filter((r) => !internal.has(r.user_id) && t(r.updated_at || r.created_at) >= from && t(r.updated_at || r.created_at) < to);
  const byModel = new Map();
  for (const r of ratings) {
    const model = runCost({ provider: r.provider, model: r.model, status: "failed" }).model;
    const row = byModel.get(model) || { model, up: 0, down: 0 };
    if (Number(r.rating) > 0) row.up++; else row.down++;
    byModel.set(model, row);
  }
  const up = ratings.filter((r) => Number(r.rating) > 0).length;

  // Every person active in the period: when they came, what they made, whether they rated and whether they bought.
  const people = new Map();
  const person = (id) => {
    if (!people.has(id)) people.set(id, { user_id: id, email: snapshot.emails?.[id] || null, signed_up_at: snapshot.signup_at?.[id] || null, surfaces: new Set(), models: new Map(),
      generations: 0, failed: 0, credits: 0, first_at: null, last_at: null, likes: 0, dislikes: 0, comment: "", paid: 0, purchases: 0, first_purchase_at: null });
    return people.get(id);
  };
  const touch = (row, at) => { if (!row.first_at || t(at) < t(row.first_at)) row.first_at = at; if (!row.last_at || t(at) > t(row.last_at)) row.last_at = at; };
  for (const g of gens) {
    if (t(g.created_at) < from || t(g.created_at) >= to) continue;
    const row = person(g.user_id);
    row.generations++; touch(row, g.created_at);
    const ok = DONE.has(String(g.status || "").toLowerCase()) || g.has_result;
    if (!ok) row.failed++; else row.credits += Number(g.charged_cost || 0) * 10;
    row.surfaces.add(g.surface === "ChatGPT" ? "ChatGPT" : "Website");
    const model = runCost(g).model;
    row.models.set(model, (row.models.get(model) || 0) + 1);
  }
  for (const [id, at] of Object.entries(snapshot.signup_at || {})) if (!internal.has(id) && t(at) >= from && t(at) < to) touch(person(id), at);
  for (const r of ratings) {
    const row = person(r.user_id);
    if (Number(r.rating) > 0) row.likes++; else row.dislikes++;
    if (r.comment && !row.comment) row.comment = r.comment;
  }
  for (const p of snapshot.payments || []) {
    if (!PAID.has(p.status) || internal.has(p.uid) || !people.has(p.uid)) continue;
    const row = people.get(p.uid);
    if (!row.first_purchase_at || t(p.paid_at) < t(row.first_purchase_at)) row.first_purchase_at = p.paid_at;
    if (t(p.paid_at) >= from && t(p.paid_at) < to) { row.purchases++; row.paid += p.usd?.known ? p.usd.gross : 0; }
    touch(row, p.paid_at);
  }
  const users = [...people.values()]
    .sort((a, b) => t(b.last_at || 0) - t(a.last_at || 0)).slice(0, 300)
    .map((row) => ({ ...row, email: row.email || (snapshot.buyers || []).find((b) => b.user_id === row.user_id)?.email || null,
      surfaces: [...row.surfaces], credits: Math.round(row.credits), paid: Math.round(row.paid * 100) / 100,
      models: [...row.models].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}${n > 1 ? ` ×${n}` : ""}`) }));

  return {
    live, compare, hours, users,
    surfaces: { chatgpt: period.chatgpt, website: period.website },
    ratings: {
      up, down: ratings.length - up,
      by_model: [...byModel.values()].sort((a, b) => b.up + b.down - (a.up + a.down)),
      recent: ratings.filter((r) => r.comment || (Array.isArray(r.reasons) ? r.reasons.length : r.reasons))
        .sort((a, b) => t(b.updated_at || b.created_at) - t(a.updated_at || a.created_at)).slice(0, 15)
        .map((r) => ({ at: r.updated_at || r.created_at, model: runCost({ provider: r.provider, model: r.model, status: "failed" }).model, rating: Number(r.rating), reasons: r.reasons, comment: r.comment || "" })),
    },
  };
}
