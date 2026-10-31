import { buildAudience } from "./audience.mjs";
import { packageBalanceBounds } from "./credit-balances.mjs";
import { INTERNAL_IDS } from "./access.mjs";
import {
  expenseTotals,
  groupError,
  dayNumber,
  dateString,
} from "../../public/business/finance.mjs";
const n = (v) =>
  v === null || v === undefined || v === ""
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
const micro = (usd) => Math.round(usd * 1e6);
const roundInvoice = (usd) => Math.ceil(usd * 1000 - 1e-8) / 1000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const localDay = (v) => dayFormatter.format(new Date(v));
const divisor = (currency) => {
  try {
    return (
      10 **
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits
    );
  } catch {
    return null;
  }
};
const yes = (v) => v === true || v === "true";
export function paymentMoney(p, fx = {}) {
  const f = p.financial || {},
    reportGross = n(f.report_gross_usd_cents),
    reportAmount = n(f.report_settlement_amount),
    reportTax = n(f.report_settlement_tax),
    reportValid =
      reportGross !== null &&
      reportAmount > 0 &&
      reportTax !== null &&
      reportTax >= 0 &&
      reportTax <= reportAmount,
    settlement = n(f.settlement_amount),
    checkout = n(f.total_amount) ?? n(p.amount_cents);
  const currency =
    settlement !== null
      ? String(f.settlement_currency || "").toUpperCase()
      : String(p.currency || "").toUpperCase();
  const gross = settlement ?? checkout,
    tax = settlement !== null ? n(f.settlement_tax) : n(f.tax);
  // If tax or settlement currency is absent, do not invent a net amount.
  const rate = currency === "USD" ? 1 : n(fx[currency]);
  const volumeMicro =
    reportGross !== null
      ? micro(reportGross / 100)
      : gross !== null && rate > 0 && divisor(currency)
        ? micro((gross / divisor(currency)) * rate)
        : null;
  const volumeFields = {
    gross_micro: volumeMicro,
    report_backed: reportGross !== null,
  };
  if (
    !reportValid &&
    (gross === null || tax === null || !currency || !rate || rate <= 0)
  )
    return {
      known: false,
      ...volumeFields,
      currency: currency || p.currency || "Unknown",
      gross_minor: gross,
      reason: "Currency conversion or tax amount missing",
    };
  const scale = divisor(currency);
  if (!scale)
    return { known: false, currency, reason: "Unknown currency units" };
  const grossUsd = reportValid ? reportGross / 100 : (gross / scale) * rate,
    revenue = reportValid
      ? grossUsd * (1 - reportTax / reportAmount)
      : ((gross - tax) / scale) * rate;
  if (revenue < 0)
    return { known: false, currency, reason: "Tax exceeds settlement" };
  const country = String(f.card_issuing_country || "").toUpperCase();
  const feeRate =
    0.04 + (country === "US" ? 0 : 0.015) + (f.subscription_id ? 0.005 : 0);
  // Published standard fee model, not an imported payout statement.
  const fee = grossUsd * feeRate + 0.4;
  let refunds = 0,
    refundUnknown = false;
  for (const refund of Array.isArray(f.refunds) ? f.refunds : []) {
    if (
      !["succeeded", "success", "completed"].includes(
        String(refund.status || "").toLowerCase(),
      )
    ) {
      refundUnknown = true;
      continue;
    }
    // Refund amounts are in checkout currency, not necessarily settlement currency.
    const rc = String(refund.currency || p.currency || "").toUpperCase(),
      rr = rc === "USD" ? 1 : n(fx[rc]);
    const amount = n(refund.amount);
    if (amount === null || !rr) {
      refundUnknown = true;
      continue;
    }
    const refundTax = n(refund.tax);
    if (tax > 0 && refundTax === null) {
      refundUnknown = true;
      continue;
    }
    const refundScale = divisor(rc);
    if (!refundScale) {
      refundUnknown = true;
      continue;
    }
    refunds += ((amount - (refundTax || 0)) / refundScale) * rr;
  }
  if (["refunded", "partially_refunded"].includes(p.status) && !refunds)
    refundUnknown = true;
  return {
    known: true,
    currency,
    gross_micro: micro(grossUsd),
    tax_micro: micro(grossUsd - revenue),
    report_backed: reportValid,
    tax_fx_allocated: reportValid && f.report_settlement_currency !== "USD",
    revenue_micro: micro(revenue),
    fee_micro: micro(fee),
    refund_micro: micro(refunds),
    refund_unknown: refundUnknown,
    converted: currency !== "USD",
    fee_estimated: true,
  };
}
export function estimateCost(g, rules = []) {
  const explicit = n(g.provider_cost_usd);
  if (explicit !== null && explicit >= 0)
    return { micro: micro(explicit), basis: "Recorded provider cost" };
  if (yes(g.provider_refunded))
    return { micro: 0, basis: "Recorded provider refund" };
  // A credit refund to the customer does not prove a provider refund.
  if (
    !["done", "ready", "completed", "success", "succeeded"].includes(
      String(g.status).toLowerCase(),
    )
  )
    return null;
  const resolution = String(g.resolution || "").toLowerCase(),
    model = String(g.model || g.provider || "").toLowerCase();
  const duration = n(g.duration),
    input = n(g.input_seconds),
    billed = n(g.billed_seconds),
    day = localDay(g.created_at);
  const rule = rules.find(
    (r) =>
      r.model === g.model &&
      (!r.resolution || r.resolution.toLowerCase() === resolution) &&
      day >= r.from &&
      (!r.to || day <= r.to),
  );
  if (rule) {
    const units =
      rule.unit === "second"
        ? duration
        : rule.unit === "billable_second"
          ? billed
          : rule.unit === "character"
            ? n(g.characters)
            : 1;
    if (units === null || units < 0) return null;
    return {
      micro: micro(Number(rule.rate) * units),
      basis: "Owner rate estimate",
    };
  }
  if (day < "2026-10-25") return null; // No backdating an Oct 25 rate card into unverified history.
  const source = String(g.source || "").toLowerCase();
  if (source.includes("unifically")) return null;
  const name = String(g.provider || "").toLowerCase();
  let usd = null;
  if (/grok/.test(model) && g.kind === "video" && duration > 0) {
    const rate = { "480p": 0.012, "720p": 0.0225, "1080p": 0.04 }[resolution];
    if (rate) usd = rate * duration;
  } else if (/veo3_lite|veo3.?1lite/.test(model + " " + name))
    usd = { "720p": 0.15, "1080p": 0.175 }[resolution] ?? null;
  else if (
    /wan3\.0-video|wan.3-0-video/.test(model) &&
    !model.includes("prime")
  ) {
    if (day > "2026-11-30") return null; // Promotion ends; require a new rate rather than perpetuating it.
    const rates =
      day >= "2026-10-30"
        ? {
            "480p": 0.028802,
            "720p": 0.057597,
            "1080p": 0.115201,
            "2k": 0.168,
            "4k": 0.1932,
          }
        : { "480p": 0.035317, "720p": 0.070625, "1080p": 0.141258 };
    const seconds =
      billed ?? (duration !== null && input !== null ? duration + input : null);
    if (rates[resolution] && seconds !== null)
      usd = roundInvoice(rates[resolution] * seconds);
  } else if (/doubao-seedance-2\.[05]-face/.test(model)) {
    const v25 = model.includes("2.5");
    const seconds =
      billed ??
      (duration !== null && input !== null
        ? v25 && input > 0
          ? Math.max(duration + Math.ceil(input), Math.ceil((5 * duration) / 3))
          : duration + Math.ceil(input)
        : null);
    if (seconds !== null && input !== null) {
      const table = v25
        ? input > 0 && !g.is_final
          ? { "480p": 0.071153, "720p": 0.160094, "1080p": 0.383966 }
          : { "480p": 0.118589, "720p": 0.266824, "1080p": 0.64275 }
        : input > 0
          ? { "480p": 0.043125, "720p": 0.09375, "1080p": 0.2325, "4k": 0.48 }
          : { "480p": 0.07125, "720p": 0.15375, "1080p": 0.3825, "4k": 0.78 };
      if (table[resolution]) usd = roundInvoice(table[resolution] * seconds);
    }
  } else if (/kling-4\.0\/reference-to-video/.test(model)) {
    const rate =
      input > 0
        ? { "720p": 0.085, "1080p": 0.1275 }[resolution]
        : { "720p": 0.1425, "1080p": 0.2125 }[resolution];
    const seconds =
      billed ??
      (duration !== null && input !== null
        ? input > 0
          ? Math.max(duration * 2, input + duration)
          : duration
        : null);
    if (rate && seconds !== null) usd = rate * seconds;
  } else if (/nano-banana-2-1/.test(model))
    usd = { "1k": 0.02, "2k": 0.03, "4k": 0.045 }[resolution] ?? null;
  else if (model === "nano-banana-2")
    usd = { "1k": 0.04, "2k": 0.06, "4k": 0.09 }[resolution] ?? null;
  else if (model === "nano-banana-2-lite")
    usd = resolution === "1k" ? 0.02 : null;
  else if (/gpt-image-2-5/.test(model))
    usd = { "1k": 0.03, "2k": 0.05, "4k": 0.08 }[resolution] ?? null;
  // ElevenLabs plan utilization/voice multipliers require an explicit owner rate.
  return usd === null
    ? null
    : {
        micro: micro(usd),
        basis: "Published rate estimate · checked 25–30 Oct 2026",
      };
}
export function buildDashboard(snapshot, range) {
  const { start, end } = range,
    settings = snapshot.settings || {},
    fx = { ...(settings.fx || {}), USD: 1 };
  const payments = [
    ...new Map(
      (snapshot.payments || []).map((p) => [
        `${p.provider}:${p.transaction_id || p.id}`,
        p,
      ]),
    ).values(),
  ];
  const allBuyer = new Map(),
    selectedPayments = [],
    excluded = new Set(INTERNAL_IDS);
  let revenue = 0,
    fees = 0,
    refunds = 0,
    unconvertedVolume = 0,
    unconverted = 0,
    grossVolume = 0,
    reportBacked = 0,
    taxAllocated = 0,
    refundUnknown = 0;
  const daily = new Map();
  for (let d = dayNumber(start); d <= dayNumber(end); d++)
    daily.set(dateString(d), {
      day: dateString(d),
      sales_micro: 0,
      cost_micro: 0,
      registrations: 0,
      generations: 0,
    });
  for (const p of payments) {
    if (excluded.has(p.uid)) continue;
    const timestamp = Date.parse(p.paid_at || p.created_at),
      day = localDay(p.paid_at || p.created_at);
    const prev = allBuyer.get(p.uid);
    if (prev === undefined || timestamp < prev) allBuyer.set(p.uid, timestamp);
    if (day < start || day > end) continue;
    const money = paymentMoney(p, fx);
    selectedPayments.push({ ...p, financial: undefined, money, day });
    if (money.gross_micro !== null && money.gross_micro !== undefined)
      grossVolume += money.gross_micro;
    else unconvertedVolume++;
    if (money.report_backed) reportBacked++;
    if (money.tax_fx_allocated) taxAllocated++;
    if (money.known) {
      revenue += money.revenue_micro;
      fees += money.fee_micro;
      refunds += money.refund_micro;
      refundUnknown += money.refund_unknown ? 1 : 0;
      daily.get(day).sales_micro += money.revenue_micro;
    } else unconverted++;
  }
  const modelMap = new Map(),
    errorMap = new Map(),
    customers = new Map(),
    surfaces = new Map(),
    channels = new Map();
  const attribution = new Map(
    (snapshot.attribution || []).map((a) => [a.user_id, a]),
  );
  const channelOf = (id) => {
    const a = attribution.get(id);
    if (!a?.source) return "Unknown";
    return /cpc|paid|ppc|ads/i.test(a.medium || "")
      ? `${a.source} · paid`
      : String(a.source).slice(0, 100);
  };
  let successful = 0,
    failed = 0,
    pending = 0,
    unknownStatus = 0,
    cost = 0,
    unpriced = 0,
    internalCost = 0,
    internalUnpriced = 0,
    nonbuyerCost = 0,
    nonbuyerUnpriced = 0,
    nonbuyerCount = 0,
    charged = 0,
    usedBuyers = new Set(),
    knownCosts = 0,
    failedUnknown = 0;
  for (const g of snapshot.generations || []) {
    const isInternal = excluded.has(g.user_id),
      status = String(g.status || "").toLowerCase(),
      done = ["done", "ready", "completed", "success", "succeeded"].includes(
        status,
      ),
      bad = ["failed", "error", "canceled", "cancelled", "rejected"].includes(
        status,
      ),
      waiting = [
        "processing",
        "pending",
        "queued",
        "running",
        "generating",
        "starting",
        "submitting",
        "audio_pending",
      ].includes(status);
    const estimate = estimateCost(g, settings.rates || []);
    if (isInternal) {
      if (estimate) internalCost += estimate.micro;
      else internalUnpriced++;
      continue;
    }
    const day = localDay(g.created_at),
      nonbuyer =
        !allBuyer.has(g.user_id) ||
        allBuyer.get(g.user_id) > Date.parse(g.created_at),
      unlimited = yes(g.unlimited);
    if (done) successful++;
    else if (bad) failed++;
    else if (waiting) pending++;
    else unknownStatus++;
    if (estimate) {
      cost += estimate.micro;
      knownCosts++;
      daily.get(day).cost_micro += estimate.micro;
    } else if (done || bad) {
      unpriced++;
      if (bad) failedUnknown++;
    }
    if (nonbuyer && !unlimited) {
      nonbuyerCount++;
      if (estimate) nonbuyerCost += estimate.micro;
      else if (done || bad) nonbuyerUnpriced++;
    }
    const debited = Math.max(0, n(g.charged_cost) || 0) * 10;
    charged += debited;
    if (
      done &&
      allBuyer.has(g.user_id) &&
      allBuyer.get(g.user_id) <= Date.parse(g.created_at)
    )
      usedBuyers.add(g.user_id);
    const modelKey = `${g.provider}|${g.model}|${g.resolution || "unspecified"}`;
    const model = modelMap.get(modelKey) || {
      provider: g.provider,
      model: g.model,
      resolution: g.resolution || "Unspecified",
      done: 0,
      failed: 0,
      pending: 0,
      cost_micro: 0,
      unknown: 0,
      credits: 0,
      nonbuyer: 0,
    };
    if (done) model.done++;
    else if (bad) model.failed++;
    else model.pending++;
    if (estimate) model.cost_micro += estimate.micro;
    else if (done || bad) model.unknown++;
    model.credits += debited;
    if (nonbuyer && !unlimited) model.nonbuyer++;
    modelMap.set(modelKey, model);
    const surface = surfaces.get(g.surface) || {
      name: g.surface,
      generations: 0,
      cost_micro: 0,
      unpriced: 0,
    };
    surface.generations++;
    if (estimate) surface.cost_micro += estimate.micro;
    else if (done || bad) surface.unpriced++;
    surfaces.set(g.surface, surface);
    const channel = channelOf(g.user_id),
      channelRow = channels.get(channel) || {
        name: channel,
        sales_micro: 0,
        cost_micro: 0,
        nonbuyer_cost_micro: 0,
        unpriced: 0,
        payments: 0,
      };
    if (estimate) {
      channelRow.cost_micro += estimate.micro;
      if (nonbuyer && !unlimited)
        channelRow.nonbuyer_cost_micro += estimate.micro;
    } else if (done || bad) channelRow.unpriced++;
    channels.set(channel, channelRow);
    const customer = customers.get(g.user_id) || {
      user_id: g.user_id,
      generations: 0,
      credits_used: 0,
      cost_micro: 0,
      unknown: 0,
    };
    customer.generations++;
    customer.credits_used += debited;
    if (estimate) customer.cost_micro += estimate.micro;
    else if (done || bad) customer.unknown++;
    customers.set(g.user_id, customer);
    daily.get(day).generations++;
    if (bad) {
      const err = groupError(g.error),
        key = `${g.provider}|${g.model}|${err.category}|${err.key}`;
      const item = errorMap.get(key) || {
        ...err,
        provider: g.provider,
        model: g.model,
        count: 0,
        users: new Set(),
        first: g.created_at,
        last: g.created_at,
        credits_refunded: 0,
        has_result: 0,
      };
      item.count++;
      item.users.add(g.user_id);
      item.first = item.first < g.created_at ? item.first : g.created_at;
      item.last = item.last > g.created_at ? item.last : g.created_at;
      if (g.has_result) item.has_result++;
      if (yes(g.refunded))
        item.credits_refunded += (n(g.refunded_cost) || 0) * 10;
      errorMap.set(key, item);
    }
  }
  for (const p of selectedPayments) {
    const channel = channelOf(p.uid),
      r = channels.get(channel) || {
        name: channel,
        sales_micro: 0,
        cost_micro: 0,
        nonbuyer_cost_micro: 0,
        unpriced: 0,
        payments: 0,
      };
    r.payments++;
    if (p.money.known) r.sales_micro += p.money.revenue_micro;
    channels.set(channel, r);
  }
  let registrations = 0;
  for (const r of snapshot.registrations || []) {
    registrations += Number(r.n);
    if (daily.has(r.day)) daily.get(r.day).registrations = Number(r.n);
  }
  const expenses = expenseTotals(snapshot.expenses || [], start, end, fx);
  const buyers = (snapshot.buyers || [])
    .filter((b) => !excluded.has(b.user_id))
    .map((b) => ({
      ...b,
      ...customers.get(b.user_id),
      balance_credits: Math.max(0, n(b.credits) || 0) * 10,
      package_credits: Number(b.package_credits || 0) * 10,
    }))
    .sort((a, b) => b.balance_credits - a.balance_credits);
  let observedCost = 0,
    observedCredits = 0;
  for (const g of snapshot.generations || []) {
    if (
      excluded.has(g.user_id) ||
      !["done", "ready", "completed", "success", "succeeded"].includes(g.status)
    )
      continue;
    const c = estimateCost(g, settings.rates || []),
      credits = n(g.charged_cost);
    if (c && credits > 0) {
      observedCost += c.micro;
      observedCredits += credits * 10;
    }
  }
  const reserveRate = observedCredits ? observedCost / observedCredits : null;
  for (const b of buyers) {
    b.package_balance = packageBalanceBounds(
      b,
      payments,
      snapshot.credit_movements || [],
    );
    b.reserve_lower_micro =
      reserveRate === null
        ? null
        : Math.round(b.package_balance.lower * reserveRate);
    b.reserve_upper_micro =
      reserveRate === null
        ? null
        : Math.round(b.package_balance.upper * reserveRate);
  }
  const packageLower = buyers.reduce(
      (sum, b) => sum + b.package_balance.lower,
      0,
    ),
    packageUpper = buyers.reduce((sum, b) => sum + b.package_balance.upper, 0);
  const reserveLower =
      reserveRate === null ? null : Math.round(packageLower * reserveRate),
    reserveUpper =
      reserveRate === null ? null : Math.round(packageUpper * reserveRate);
  const balance = buyers.reduce((s, b) => s + b.balance_credits, 0);
  const refundRows = [...(snapshot.refunds || [])],
    refundKeys = new Set(refundRows.map((r) => r.run_id || r.generation_id));
  for (const r of snapshot.metadata_refunds || [])
    if (!refundKeys.has(r.run_id || r.generation_id)) {
      refundRows.push(r);
      refundKeys.add(r.run_id || r.generation_id);
    }
  const refundedCredits = refundRows
    .filter((r) => !excluded.has(r.user_id))
    .reduce((s, r) => s + (n(r.amount) || 0) * 10, 0);
  const issues = [];
  const statusConflicts = (snapshot.generations || []).filter(
    (g) =>
      ["failed", "error"].includes(g.status) &&
      g.has_result &&
      !excluded.has(g.user_id),
  ).length;
  if (statusConflicts)
    issues.push({
      code: "status_conflict",
      count: statusConflicts,
      label: `${statusConflicts} failed records also have a result; delivery status needs review`,
    });
  if (unconverted)
    issues.push({
      code: "currency",
      count: unconverted,
      label: `${unconverted} payments need currency/tax reconciliation`,
    });
  if (unpriced)
    issues.push({
      code: "cost",
      count: unpriced,
      label: `${unpriced} completed/failed jobs have unconfirmed provider cost`,
    });
  if (expenses.missing_fx)
    issues.push({
      code: "expense_fx",
      count: expenses.missing_fx,
      label: `${expenses.missing_fx} expenses need a currency conversion`,
    });
  if (refundUnknown)
    issues.push({
      code: "refund",
      count: refundUnknown,
      label: `${refundUnknown} payments have unconfirmed refunds`,
    });
  const extra = snapshot.extra_payment_sources || {};
  if (extra.telegram_credit_grants || extra.russian_checkout_logs)
    issues.push({
      code: "other_sales",
      label: "Telegram/Russian checkout activity needs payment reconciliation",
    });
  const cash =
    revenue -
    refunds -
    fees -
    cost -
    internalCost -
    expenses.cash_cents * 10000;
  // No invented "final profit": unspent-credit allocation and imported provider invoices remain unreconciled.
  return {
    range,
    generated_at: snapshot.generated_at,
    ...buildAudience(snapshot, range),
    settings,
    payment_providers: [
      ...new Set(selectedPayments.map((p) => p.provider)),
    ].map((provider) => {
      const rows = selectedPayments.filter((p) => p.provider === provider);
      return {
        provider,
        payments: rows.length,
        known_volume_micro: rows.reduce(
          (a, p) => a + (p.money.gross_micro || 0),
          0,
        ),
        unconverted: rows.filter(
          (p) =>
            p.money.gross_micro === null || p.money.gross_micro === undefined,
        ).length,
        report_backed: rows.filter((p) => p.money.report_backed).length,
      };
    }),
    summary: {
      sales_micro: revenue,
      gross_volume_micro: grossVolume,
      report_backed_payments: reportBacked,
      tax_fx_allocated_payments: taxAllocated,
      unconverted_payments: unconverted,
      unconverted_volume_payments: unconvertedVolume,
      fees_micro: fees,
      refunds_micro: refunds,
      payments: selectedPayments.length,
      buyers: new Set(selectedPayments.map((p) => p.uid)).size,
      repeat_buyers: new Set(
        selectedPayments
          .filter((p) => allBuyer.get(p.uid) < Date.parse(start + "T00:00:00Z"))
          .map((p) => p.uid),
      ).size,
      registrations,
      successful,
      failed,
      pending,
      unknown_status: unknownStatus,
      failure_rate: successful + failed ? failed / (successful + failed) : 0,
      cost_micro: cost,
      known_cost_jobs: knownCosts,
      unpriced_jobs: unpriced,
      failed_unpriced: failedUnknown,
      internal_cost_micro: internalCost,
      internal_unpriced: internalUnpriced,
      nonbuyer_cost_micro: nonbuyerCost,
      nonbuyer_unpriced: nonbuyerUnpriced,
      nonbuyer_generations: nonbuyerCount,
      credits_debited: charged,
      credits_refunded: refundedCredits,
      used_buyers: usedBuyers.size,
      buyer_balance: balance,
      package_balance_lower: packageLower,
      package_balance_upper: packageUpper,
      reserve_lower_micro: reserveLower,
      reserve_upper_micro: reserveUpper,
      cash_after_known_costs_micro: cash,
      expense_allocated_cents: expenses.allocated_cents,
      expense_cash_cents: expenses.cash_cents,
      expense_projected_cents: expenses.projected_cents,
      profit_micro: null,
    },
    daily: [...daily.values()],
    models: [...modelMap.values()].sort(
      (a, b) => b.cost_micro - a.cost_micro || b.done - a.done,
    ),
    errors: [...errorMap.values()]
      .map((e) => ({ ...e, users: e.users.size }))
      .sort((a, b) => b.count - a.count),
    surfaces: [...surfaces.values()],
    channels: [...channels.values()],
    buyers,
    expenses: expenses.rows,
    archived_expenses: (snapshot.expenses || []).filter((e) => e.archived_at),
    payments: selectedPayments,
    issues,
    methodology: {
      sales:
        "Payment volume is gross, tax-inclusive USD. Imported Dodo report USD equivalents take precedence over webhook settlement data. Revenue excludes tax. For foreign settlements, tax is allocated using each report row’s implied FX rate and remains a conversion estimate. Unconverted payments remain outside USD subtotals. YooMoney and Dodo counts are separate.",
      fees: "Estimated standard Dodo checkout fees: 4% + $0.40, +1.5% non-US/unknown country, +0.5% subscriptions; tax-inclusive basis. FX and payout fees excluded.",
      nonbuyer:
        "Usage before the first recorded purchase, excluding explicitly unlimited jobs. It is a free-usage proxy; other payment channels may be missing.",
      credits:
        "Purchased-package balance bounds replay credit movements and match purchase grants. Debits do not identify paid versus free funds, so an exact allocation is shown only when the bounds agree. Package bonuses are included. Missing grants or ledger gaps widen the range. Reserve estimates use the selected period’s known successful-job cost per charged credit; future model choices may differ.",
      profit:
        "Cash after known costs is a cash-flow estimate, not earned profit. Final profit requires settled provider costs, complete payments/refunds and a reconciled unused-credit ledger.",
      retry:
        "Separate retries are not reliably linked in historical records. Recovered retry counts are not guessed.",
    },
  };
}
