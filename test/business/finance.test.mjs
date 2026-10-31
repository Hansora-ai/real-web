import test from "node:test";
import assert from "node:assert/strict";
import {
  allocatedCents,
  expenseTotals,
  expenseOccurrences,
  validateExpense,
  dayNumber,
  dateRange,
  groupError,
} from "../../public/business/finance.mjs";
const expense = (overrides) =>
  validateExpense({
    name: "AI subscription",
    amount: "240.00",
    category: "software",
    currency: "USD",
    paid_on: "2026-01-01",
    starts_on: "2026-01-01",
    ends_on: "2026-12-31",
    recurrence: "none",
    ...overrides,
  });
test("allocating an annual invoice conserves every cent across all days and months", () => {
  const e = expense();
  let total = 0;
  for (let i = dayNumber("2026-01-01"); i <= dayNumber("2026-12-31"); i++) {
    const day = new Date(i * 86400000).toISOString().slice(0, 10);
    total += allocatedCents(e.amount_cents, e.starts_on, e.ends_on, day, day);
  }
  assert.equal(total, 24000);
  assert.equal(
    allocatedCents(1, "2026-01-01", "2026-01-03", "2026-01-01", "2026-01-03"),
    1,
  );
});
test("cash payment before a future coverage period remains visible", () => {
  const e = expense({
      paid_on: "2026-01-01",
      starts_on: "2026-02-01",
      ends_on: "2026-02-28",
    }),
    r = expenseTotals([e], "2026-01-01", "2026-01-31");
  assert.equal(r.cash_cents, 24000);
  assert.equal(r.allocated_cents, 0);
});
test("month-end renewals stay anchored, without March drift or overlapping days", () => {
  const e = expense({
      amount: "20",
      paid_on: "2026-01-31",
      starts_on: "2026-01-31",
      ends_on: "2026-01-31",
      recurrence: "monthly",
    }),
    r = expenseOccurrences(e, "2026-03-31");
  assert.deepEqual(
    r.map((x) => x.start),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(r[0].end, "2026-02-27");
  assert.equal(r[1].end, "2026-03-30");
});
test("repeat stop, archives and missing currency conversions are respected", () => {
  const e = expense({
    amount: "20",
    recurrence: "monthly",
    repeat_until: "2026-02-01",
  });
  assert.equal(expenseOccurrences(e, "2026-12-31").length, 2);
  assert.equal(
    expenseTotals(
      [{ ...e, archived_at: "2026-01-02" }],
      "2026-01-01",
      "2026-12-31",
    ).allocated_cents,
    0,
  );
  const r = expenseTotals(
    [expense({ currency: "EUR" })],
    "2026-01-01",
    "2026-12-31",
  );
  assert.equal(r.missing_fx, 1);
  assert.equal(r.allocated_cents, 0);
  assert.equal(r.rows[0].usd_cents, null);
});
test("invalid and overprecise amounts and impossible dates are rejected", () => {
  assert.throws(() => expense({ amount: "20.001" }));
  assert.throws(() => expense({ paid_on: "2026-02-30" }));
  assert.throws(() => expense({ ends_on: "2025-12-31" }));
  assert.equal(expense({ amount: "0.01" }).amount_cents, 1);
});
test("half-year and annual ranges remain inside the selected calendar year", () => {
  assert.deepEqual(dateRange("half", "2026-10-31"), {
    start: "2026-05-01",
    end: "2026-10-31",
  });
  assert.equal(dateRange("year", "2026-10-31").start, "2026-01-01");
});
test("similar dynamic errors group without conflating unrelated failure messages", () => {
  const a = groupError("Insufficient credits. Required: 1498"),
    b = groupError("Insufficient credits. Required: 864");
  assert.equal(a.key, b.key);
  assert.equal(a.category, "Insufficient balance");
  assert.notEqual(
    groupError("Internal Error, Please try again later.").key,
    a.key,
  );
  assert.equal(
    groupError("Concurrent task limit (10) reached").category,
    "Concurrency / rate limit",
  );
});

// A purchased balance is an interval unless the source of every debit is known.
import { packageBalanceBounds } from "../../lib/business/credit-balances.mjs";
test("package balance bounds preserve trial ambiguity instead of inventing FIFO", () => {
  const buyer = { user_id: "u", credits: 84 },
    payments = [
      { id: 1, uid: "u", credits: 90, paid_at: "2026-10-30T10:00:00Z" },
    ],
    rows = [
      {
        id: 1,
        user_id: "u",
        old_credits: 4,
        new_credits: 94,
        delta: 90,
        payment_id: 1,
        changed_at: "2026-10-30T10:00:00Z",
      },
      {
        id: 2,
        user_id: "u",
        old_credits: 94,
        new_credits: 84,
        delta: -10,
        changed_at: "2026-10-30T11:00:00Z",
      },
    ];
  assert.deepEqual(packageBalanceBounds(buyer, payments, rows), {
    lower: 800,
    upper: 840,
    matched: 1,
    payments: 1,
    reconciled: false,
  });
});
test("missing ledger grants never become a falsely exact purchased balance", () => {
  const r = packageBalanceBounds(
    { user_id: "u", credits: 20 },
    [{ id: 1, uid: "u", credits: 90 }],
    [],
  );
  assert.equal(r.lower, 0);
  assert.equal(r.upper, 200);
  assert.equal(r.reconciled, false);
});
test("a wallet containing only a matched purchase reconciles exactly", () => {
  const r = packageBalanceBounds(
    { user_id: "u", credits: 90 },
    [{ id: 1, uid: "u", credits: 90 }],
    [
      {
        id: 1,
        user_id: "u",
        old_credits: 0,
        new_credits: 90,
        delta: 90,
        payment_id: 1,
        changed_at: "2026-10-30T10:00:00Z",
      },
    ],
  );
  assert.equal(r.lower, 900);
  assert.equal(r.upper, 900);
  assert.equal(r.reconciled, true);
});
test("HTTP error status codes are preserved while dynamic amounts still normalize", () => {
  assert.notEqual(
    groupError("HTTP 429 request failed").key,
    groupError("HTTP 500 request failed").key,
  );
  assert.equal(
    groupError("Insufficient credits. Required: 20").key,
    groupError("Insufficient credits. Required: 30").key,
  );
});
test("trial grants can never make purchased-package bounds exceed credits actually issued", () => {
  const r = packageBalanceBounds(
    { user_id: "u", credits: 313 },
    [{ id: 1, uid: "u", credits: 310 }],
    [
      {
        id: 1,
        user_id: "u",
        old_credits: 3,
        new_credits: 313,
        delta: 310,
        payment_id: 1,
        changed_at: "2026-10-30T10:00:00Z",
      },
    ],
  );
  assert.equal(r.lower, 3100);
  assert.equal(r.upper, 3100);
});
