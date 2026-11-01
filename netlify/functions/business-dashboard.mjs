import {
  requireOwner,
  database,
  json,
  OWNER_ID,
} from "../../lib/business/access.mjs";
import { buildProfit, paymentUsd } from "../../lib/business/profit.mjs";
import { INTERNAL_IDS } from "../../lib/business/access.mjs";
import { validateExpense, dayNumber, dateString } from "../../public/business/finance.mjs";
const uuid = (value) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value || "",
  );
// Payments our webhook saved without settlement or tax would be left out; Dodo's own record fills them in.
async function completeFromDodo(snapshot, lo, hi) {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) return;
  const base = String(process.env.DODO_PAYMENTS_BASE_URL || "https://live.dodopayments.com").replace(/\/+$/, "");
  const missing = (snapshot.payments || []).filter((p) => p.provider === "dodopayments" && p.transaction_id
    && p.paid_at >= lo && p.paid_at < hi && !paymentUsd(p, snapshot.settings || {}).known).slice(0, 40);
  await Promise.all(missing.map(async (p) => {
    try {
      const response = await fetch(`${base}/payments/${encodeURIComponent(p.transaction_id)}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) p.dodo = await response.json();
    } catch {}
  }));
}

// The official ruble → dollar rate of a day, from public daily rates (no key needed); remembered while warm.
const rubRates = new Map();
async function rubToUsd(date) {
  if (rubRates.has(date)) return rubRates.get(date);
  const get = async (url, pick) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const rate = Number(pick(await response.json()));
      return rate > 0 && rate < 1 ? rate : null;
    } catch {
      return null;
    }
  };
  const [y, m, d] = date.split("-");
  const rate = (await get(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/rub.json`, (j) => j?.rub?.usd))
    || (await get(`https://${date}.currency-api.pages.dev/v1/currencies/rub.json`, (j) => j?.rub?.usd))
    || (await get(`https://www.cbr-xml-daily.ru/archive/${y}/${m}/${d}/daily_json.js`, (j) => j?.Valute?.USD && j.Valute.USD.Nominal / j.Valute.USD.Value))
    || (await get("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/rub.json", (j) => j?.rub?.usd));
  if (rate) rubRates.set(date, rate);
  return rate;
}

// YooMoney's own amounts (what the buyer paid and what Hansora received) and the day's ruble rate.
async function completeYooMoney(auth, snapshot, lo, hi) {
  const ours = (snapshot.payments || []).filter((p) => p.provider === "yoomoney" && p.paid_at >= lo && p.paid_at < hi);
  if (!ours.length) return;
  const rows = await database(auth, `payments?provider=eq.yoomoney&paid_at=gte.${lo}&paid_at=lt.${hi}&select=transaction_id,received:payload->>amount,paid:payload->>withdraw_amount&limit=2000`).catch(() => []);
  const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.transaction_id, r]));
  for (const p of ours) if (byId.has(p.transaction_id)) p.yoomoney = byId.get(p.transaction_id);
  const dates = [...new Set(ours.map((p) => new Date(p.paid_at).toISOString().slice(0, 10)))].slice(0, 62);
  const found = await Promise.all(dates.map(async (date) => [date, await rubToUsd(date)]));
  snapshot.rub_usd = Object.fromEntries(found.filter(([, rate]) => rate));
}

export async function handler(event) {
  try {
    if (!["GET", "POST"].includes(event.httpMethod))
      return json(405, { error: "Method not allowed." });
    const auth = await requireOwner(event);
    if (event.httpMethod === "GET") {
      const { start, end } = event.queryStringParameters || {};
      if (
        !start ||
        !end ||
        dayNumber(end) < dayNumber(start) ||
        dayNumber(end) - dayNumber(start) > 366
      )
        return json(400, {
          error: "Choose a valid date range of up to 367 days.",
        });
      // Days are UTC days, like Dodo's "Today" figures and payment list. The cost of one credit is measured over
      // the 30 days before the end, so those generations are read too.
      const from = dateString(Math.min(dayNumber(start), dayNumber(end) - 30));
      const snapshot = await database(auth, "rpc/business_dashboard_snapshot", {
        method: "POST",
        body: JSON.stringify({ p_start: from, p_end: end }),
      });
      const lo = `${start}T00:00:00Z`, hi = `${dateString(dayNumber(end) + 1)}T00:00:00Z`;
      const signups = await database(auth, `profiles?select=a&a=gte.${lo}&a=lt.${hi}&user_id=not.in.(${INTERNAL_IDS.join(",")})&limit=50000`).catch(() => null);
      if (Array.isArray(signups)) snapshot.signup_times = signups.map((r) => r.a).filter(Boolean);
      await completeFromDodo(snapshot, lo, hi);
      await completeYooMoney(auth, snapshot, lo, hi);
      return json(200, buildProfit(snapshot, { start, end }));
    }
    if ((event.body || "").length > 50000)
      return json(413, { error: "Request is too large." });
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Enter valid data." });
    }
    if (body.action === "save_expense") {
      let expense;
      try {
        expense = validateExpense(body.expense || {});
      } catch (error) {
        return json(400, { error: error.message });
      }
      const id = body.id;
      if (id && !uuid(id)) return json(400, { error: "Invalid expense." });
      const path = id
        ? `business_expenses?id=eq.${id}&owner_user_id=eq.${OWNER_ID}`
        : "business_expenses";
      const rows = await database(auth, path, {
        method: id ? "PATCH" : "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...expense,
          owner_user_id: OWNER_ID,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!rows?.[0]) return json(404, { error: "Expense not found." });
      return json(200, { ok: true, id: rows[0].id });
    }
    if (["archive_expense", "restore_expense"].includes(body.action)) {
      if (!uuid(body.id)) return json(400, { error: "Invalid expense." });
      const rows = await database(
        auth,
        `business_expenses?id=eq.${body.id}&owner_user_id=eq.${OWNER_ID}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            archived_at:
              body.action === "restore_expense"
                ? null
                : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        },
      );
      return json(rows?.length ? 200 : 404, { ok: !!rows?.length });
    }
    if (body.action === "save_settings") {
      const settings = body.settings || {},
        fx = {},
        rates = [],
        fees = {};
      const yoomoneyPct = Number(settings.fees?.yoomoney_pct ?? 0);
      if (!Number.isFinite(yoomoneyPct) || yoomoneyPct < 0 || yoomoneyPct > 50)
        return json(400, { error: "Enter a YooMoney fee between 0 and 50%." });
      fees.yoomoney_pct = yoomoneyPct;
      for (const [currency, value] of Object.entries(settings.fx || {})) {
        if (
          !/^[A-Z]{3}$/.test(currency) ||
          !Number.isFinite(Number(value)) ||
          Number(value) <= 0 ||
          Number(value) > 1000000
        )
          return json(400, { error: "Enter valid USD conversion rates." });
        fx[currency] = Number(value);
      }
      if (!Array.isArray(settings.rates ?? []) || (settings.rates ?? []).length > 150)
        return json(400, { error: "Use up to 150 provider rate rules." });
      for (const r of settings.rates ?? []) {
        if (
          typeof r.model !== "string" ||
          !r.model.trim() ||
          r.model.length > 200 ||
          !["job", "second", "billable_second", "character"].includes(r.unit) ||
          !Number.isFinite(Number(r.rate)) ||
          Number(r.rate) < 0 ||
          Number(r.rate) > 10000
        )
          return json(400, { error: "Enter valid provider rates." });
        try {
          dayNumber(r.from);
          if (r.to && dayNumber(r.to) < dayNumber(r.from)) throw Error();
        } catch {
          return json(400, { error: "Enter valid provider rate dates." });
        }
        rates.push({
          model: r.model.trim(),
          resolution: String(r.resolution || "").slice(0, 20),
          rate: Number(r.rate),
          unit: r.unit,
          from: r.from,
          to: r.to || null,
        });
      }
      await database(auth, "business_settings?on_conflict=owner_user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          owner_user_id: OWNER_ID,
          settings: { fx, rates, fees },
          updated_at: new Date().toISOString(),
        }),
      });
      return json(200, { ok: true });
    }
    return json(400, { error: "Unknown action." });
  } catch (error) {
    if (!error.status && /valid date/.test(error.message))
      return json(400, { error: error.message });
    console.error("business_dashboard_error", error.status || 500);
    return json(error.status || 500, {
      error: error.status
        ? error.message
        : "The dashboard could not load. Please retry.",
    });
  }
}
