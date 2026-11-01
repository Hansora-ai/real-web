// The owner's profit dashboard, per Armenia day (the day the owner sees in Dodo's dashboard).
//
// Sales: Dodo amounts as Dodo records them (gross, tax, refunds) with Dodo's standard fee (4% + 1.5% outside
// the US + $0.40 per payment), and YooMoney in rubles at the owner's RUB→USD rate and fee. The owner's own
// purchases count, as they do in Dodo.
// Profit follows the sale: the day credits are sold, their provider cost is counted as credits sold × what one
// credit really costs (measured from buyers' generations of the last 30 days). Buyers using credits later is
// therefore not a cost again. Free users' generations and the owner's own runs are real costs of their day, as
// are expenses spread over the days they cover. Provider spending per day is shown separately for reference.
// Credits: what buyers bought, used and still hold. Free credits are spent first, then the oldest pack.
import { paymentMoney } from "./analytics.mjs";
import { runCost } from "./costs.mjs";
import { INTERNAL_IDS } from "./access.mjs";
import { expenseTotals, dayNumber, dateString } from "../../public/business/finance.mjs";

const PAID = new Set(["succeeded", "paid", "refunded", "partially_refunded"]);
const DONE = new Set(["done", "ready", "completed", "success", "succeeded"]);
const armenia = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yerevan", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (v) => armenia.format(new Date(v));
const FALLBACK_COST_PER_CREDIT = 0.0068;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// One payment in USD: { gross, tax, refunds, fees, net, known, currency, amount }.
export function paymentUsd(p, settings = {}) {
  const fx = { ...(settings.fx || {}), USD: 1 };
  if (p.provider === "yoomoney") {
    const currency = String(p.currency || "RUB").toUpperCase() === "643" ? "RUB" : String(p.currency || "RUB").toUpperCase();
    const amount = num(p.amount_cents) / 100;
    const rate = currency === "USD" ? 1 : num(fx[currency]);
    const feePct = num(settings.fees?.yoomoney_pct);
    if (!rate) return { known: false, currency, amount, gross: 0, tax: 0, refunds: 0, fees: 0, net: 0 };
    const gross = amount * rate, fees = (gross * feePct) / 100;
    return { known: true, currency, amount, gross, tax: 0, refunds: 0, fees, net: gross - fees };
  }
  let m = paymentMoney(p, fx);
  // A payment our webhook saved without settlement or tax: Dodo's own record of it, fetched by the endpoint.
  if (!m.known && p.dodo) {
    const d = p.dodo;
    m = paymentMoney({ ...p, currency: d.currency || p.currency, amount_cents: d.total_amount ?? p.amount_cents, financial: {
      settlement_amount: d.settlement_amount, settlement_currency: d.settlement_currency, settlement_tax: d.settlement_tax,
      total_amount: d.total_amount, tax: d.tax, card_issuing_country: d.card_issuing_country, subscription_id: d.subscription_id,
      refunds: d.refunds, payment_method: d.payment_method } }, fx);
  }
  if (!m.known) return { known: false, currency: m.currency, amount: num(m.gross_minor) / 100, gross: (m.gross_micro || 0) / 1e6, tax: 0, refunds: 0, fees: 0, net: 0 };
  const gross = m.gross_micro / 1e6, tax = m.tax_micro / 1e6, refunds = m.refund_micro / 1e6, fees = m.fee_micro / 1e6;
  return { known: true, currency: m.currency, gross, tax, refunds, fees, net: gross - tax - refunds - fees };
}

function emptyDay(d) {
  return {
    day: d, payments: 0, gross: 0, tax: 0, refunds: 0, fees: 0, net: 0,
    cost: 0, cost_free: 0, cost_buyers: 0, cost_internal: 0, cost_of_sold: 0, expenses: 0, profit: 0,
    signups: 0, generators: 0, generations: 0, failed: 0, new_buyers: 0, repeat_buyers: 0,
    credits_sold: 0, credits_used_buyers: 0, credits_used_free: 0,
  };
}

export function buildProfit(snapshot, { start, end }) {
  const settings = snapshot.settings || {};
  const internal = new Set(INTERNAL_IDS);
  const days = new Map();
  for (let d = dayNumber(start); d <= dayNumber(end); d++) days.set(dateString(d), emptyDay(dateString(d)));
  const inRange = (d) => days.has(d);

  // Payments, deduplicated by processor transaction.
  const payments = [...new Map((snapshot.payments || []).filter((p) => PAID.has(p.status))
    .map((p) => [`${p.provider}:${p.transaction_id || p.id}`, p])).values()];
  const firstPaid = new Map(), buyerPayments = new Map();
  for (const p of [...payments].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at))) {
    if (!p.uid) continue;
    if (!firstPaid.has(p.uid)) firstPaid.set(p.uid, p.paid_at);
    if (!buyerPayments.has(p.uid)) buyerPayments.set(p.uid, []);
    buyerPayments.get(p.uid).push(p);
  }
  const sales = [], unconverted = [];
  for (const p of payments) {
    const d = day(p.paid_at);
    const usd = paymentUsd(p, settings);
    p.usd = usd;
    if (!inRange(d)) continue;
    const row = days.get(d);
    if (!usd.known) { unconverted.push({ provider: p.provider, currency: usd.currency, amount: usd.amount, day: d }); continue; }
    row.payments++; row.gross += usd.gross; row.tax += usd.tax; row.refunds += usd.refunds; row.fees += usd.fees; row.net += usd.net;
    // The owner's own purchases count as money (Dodo counts them); their use is already "own use".
    if (!internal.has(p.uid)) row.credits_sold += num(p.credits) * 10;
    if (!internal.has(p.uid)) { if (firstPaid.get(p.uid) === p.paid_at) row.new_buyers++; else row.repeat_buyers++; }
    sales.push({ day: d, paid_at: p.paid_at, provider: p.provider === "yoomoney" ? "YooMoney" : "Dodo", credits: num(p.credits) * 10, ...roundMoney(usd), email: null, user_id: p.uid });
  }

  // Generations: cost per run, split by who ran it.
  const byModel = new Map(), generatorsByDay = new Map();
  let unknownCost = 0, estimatedRuns = 0, runs = 0, windowCost = 0, windowCredits = 0;
  // The 30 days before the end of the period (Armenia days are UTC+4).
  const windowStart = (dayNumber(end) + 1) * 864e5 - 4 * 36e5 - 30 * 864e5;
  for (const g of snapshot.generations || []) {
    const d = day(g.created_at);
    const c = runCost(g);
    // What one bought credit really costs: buyers' successful runs of the last 30 days.
    if (!internal.has(g.user_id) && c.usd != null && num(g.charged_cost) > 0 && new Date(g.created_at) >= windowStart
      && (DONE.has(String(g.status || "").toLowerCase()) || g.has_result)
      && firstPaid.has(g.user_id) && new Date(firstPaid.get(g.user_id)) <= new Date(g.created_at)) {
      windowCost += c.usd; windowCredits += num(g.charged_cost) * 10;
    }
    if (!inRange(d)) continue;
    const row = days.get(d);
    const usd = c.usd ?? 0;
    if (c.usd == null) unknownCost++;
    if (["credits", "default", "average"].includes(c.how)) estimatedRuns++;
    const done = DONE.has(String(g.status || "").toLowerCase()) || g.has_result;
    const credits = done ? num(g.charged_cost) * 10 : 0;
    const who = internal.has(g.user_id) ? "internal" : firstPaid.has(g.user_id) && new Date(firstPaid.get(g.user_id)) <= new Date(g.created_at) ? "buyer" : "free";
    row.cost += usd;
    row[`cost_${who === "buyer" ? "buyers" : who}`] += usd;
    if (who === "internal") continue;
    runs++;
    row.generations++;
    if (!done) row.failed++;
    if (who === "buyer") row.credits_used_buyers += credits; else row.credits_used_free += credits;
    if (!generatorsByDay.has(d)) generatorsByDay.set(d, new Set());
    generatorsByDay.get(d).add(g.user_id);
    const m = byModel.get(c.model) || { model: c.model, runs: 0, failed: 0, credits: 0, cost: 0, free_runs: 0, users: new Set() };
    m.runs++; if (!done) m.failed++; m.credits += credits; m.cost += usd; if (who === "free") m.free_runs++; m.users.add(g.user_id);
    byModel.set(c.model, m);
  }
  for (const [d, set] of generatorsByDay) days.get(d).generators = set.size;
  if (Array.isArray(snapshot.signup_times)) {
    for (const t of snapshot.signup_times) { const d = day(t); if (inRange(d)) days.get(d).signups++; }
  } else {
    for (const r of snapshot.registrations || []) if (inRange(String(r.day).slice(0, 10))) days.get(String(r.day).slice(0, 10)).signups = num(r.n);
  }
  const costPerCredit = windowCredits >= 1000 ? windowCost / windowCredits : FALLBACK_COST_PER_CREDIT;

  // Expenses, spread over the days each one covers (a $25 monthly bill is ~$0.82 a day).
  const fx = { ...(settings.fx || {}), USD: 1 };
  const expenses = (snapshot.expenses || []).filter((e) => !e.archived_at);
  for (const row of days.values()) row.expenses = expenseTotals(expenses, row.day, row.day, fx).allocated_cents / 100;
  for (const row of days.values()) {
    row.cost_of_sold = row.credits_sold * costPerCredit;
    row.profit = row.net - row.cost_of_sold - row.cost_free - row.cost_internal - row.expenses;
  }

  // What a buyer's credit is worth: the net money paid per credit received, from that buyer's packs.
  const buyerRows = [];
  let unusedCredits = 0, unusedValue = 0;
  for (const b of snapshot.buyers || []) {
    if (internal.has(b.user_id)) continue;
    const list = buyerPayments.get(b.user_id) || [];
    const bought = list.reduce((a, p) => a + num(p.credits) * 10, 0);
    const paid = list.reduce((a, p) => a + (p.usd?.known ? p.usd.net : 0), 0);
    const balance = num(b.credits) * 10;
    // Free credits are spent first, so what is left is bought credits, from the newest pack backwards.
    const unused = Math.min(balance, bought);
    let left = unused, value = 0;
    for (const p of [...list].reverse()) {
      const c = num(p.credits) * 10, take = Math.min(left, c);
      if (take > 0 && p.usd?.known && c > 0) value += (take * p.usd.net) / c;
      left -= take;
    }
    unusedCredits += unused; unusedValue += value;
    buyerRows.push({ email: b.email, user_id: b.user_id, first_payment: b.first_payment, payments: list.length, bought, paid: r2(paid), balance, unused, unused_value: r2(value) });
  }
  buyerRows.sort((a, b) => b.unused_value - a.unused_value);

  // Totals for the period.
  const total = emptyDay(null);
  for (const row of days.values()) for (const k of Object.keys(total)) if (k !== "day") total[k] += row[k];
  const people = new Set();
  for (const set of generatorsByDay.values()) for (const u of set) people.add(u);
  total.generators = people.size;
  const reserve = unusedCredits * costPerCredit;

  // What new buyers did before they paid.
  const journeys = [], lastModels = new Map();
  for (const j of snapshot.purchase_journeys || []) {
    if (internal.has(j.user_id) || !inRange(day(j.first_purchase))) continue;
    const gens = [...(j.generations || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const ok = gens.filter((g) => DONE.has(String(g.status || "").toLowerCase()));
    const last = ok.length ? runCost(ok[ok.length - 1]).model : gens.length ? "Only failed tries" : "Nothing before buying";
    lastModels.set(last, (lastModels.get(last) || 0) + 1);
    const first = gens[0]?.created_at;
    journeys.push({
      user_id: j.user_id, email: (snapshot.buyers || []).find((b) => b.user_id === j.user_id)?.email || null,
      first_purchase: j.first_purchase, last_model: last, generations: gens.length, failed: gens.length - ok.length,
      models: [...new Set(gens.map((g) => runCost(g).model))],
      hours_to_buy: first ? r2((new Date(j.first_purchase) - new Date(first)) / 36e5) : null,
    });
  }
  journeys.sort((a, b) => new Date(b.first_purchase) - new Date(a.first_purchase));

  const daysOut = [...days.values()].map((row) => ({ ...roundMoney(row), day: row.day }));
  return {
    range: { start, end }, generated_at: snapshot.generated_at || new Date().toISOString(),
    totals: {
      ...roundMoney(total),
      margin: total.net > 0 ? r2((total.profit / total.net) * 100) : null,
      unused_credits_now: Math.round(unusedCredits), unused_value_now: r2(unusedValue),
      reserve_for_unused_now: r2(reserve),
      cost_per_credit: costPerCredit, cost_per_credit_measured: windowCredits >= 1000,
    },
    quality: {
      runs, estimated_runs: estimatedRuns, unknown_cost_runs: unknownCost, unconverted_payments: unconverted,
      needs_rub_rate: unconverted.some((u) => u.currency === "RUB"),
    },
    days: daysOut,
    models: [...byModel.values()].map((m) => ({ model: m.model, runs: m.runs, failed: m.failed, free_runs: m.free_runs, users: m.users.size, credits: Math.round(m.credits), cost: r2(m.cost) }))
      .sort((a, b) => b.cost - a.cost),
    sales: sales.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)).map((s) => ({ ...s, email: (snapshot.buyers || []).find((b) => b.user_id === s.user_id)?.email || null })),
    buyers: buyerRows,
    journeys, last_models: [...lastModels].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
    expenses: expenses.map((e) => ({ id: e.id, name: e.name, category: e.category, amount: num(e.amount_cents) / 100, currency: e.currency, recurrence: e.recurrence, starts_on: e.starts_on, paid_on: e.paid_on, ends_on: e.ends_on, repeat_until: e.repeat_until, note: e.note })),
    settings: { fx: settings.fx || {}, fees: settings.fees || {} },
  };
}

function roundMoney(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === "number" && !["payments", "signups", "generators", "generations", "failed", "new_buyers", "repeat_buyers", "credits_sold", "credits_used_buyers", "credits_used_free"].includes(k) ? r2(v) : typeof v === "number" ? Math.round(v) : v;
  return out;
}
