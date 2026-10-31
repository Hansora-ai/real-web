// Shared, deterministic money/date calculations. Expense allocations conserve every cent.
export const DAY = 86400000;
export function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))
    throw Error("Enter a valid date.");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw Error("Enter a valid date.");
  return time / DAY;
}
export const dateString = (day) =>
  new Date(day * DAY).toISOString().slice(0, 10);
export const todayUTC = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function dateRange(preset, today = todayUTC()) {
  const end = dayNumber(today),
    d = new Date(`${today}T00:00:00Z`);
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday":
      return { start: dateString(end - 1), end: dateString(end - 1) };
    case "week":
      return { start: dateString(end - 6), end: today };
    case "month":
      return { start: monthStart, end: today };
    case "half":
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - 5);
      return { start: d.toISOString().slice(0, 10), end: today };
    case "year":
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    default:
      return { start: dateString(end - 29), end: today };
  }
}
export function parseMoney(value) {
  const raw = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw))
    throw Error("Use an amount with up to two decimal places.");
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents <= 0 || !Number.isSafeInteger(cents))
    throw Error("Enter an amount greater than zero.");
  return cents;
}
export function validateExpense(input) {
  const name = String(input.name || "").trim(),
    category = String(input.category || "other");
  if (!name || name.length > 140)
    throw Error("Enter an expense name, up to 140 characters.");
  if (
    !["advertising", "software", "hosting", "contractor", "other"].includes(
      category,
    )
  )
    throw Error("Choose an expense category.");
  const cents =
    input.amount_cents !== undefined
      ? Number(input.amount_cents)
      : parseMoney(input.amount);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999)
    throw Error("Enter a valid expense amount.");
  const currency = String(input.currency || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw Error("Use a three-letter currency code.");
  const paid_on = String(input.paid_on || ""),
    starts_on = String(input.starts_on || paid_on);
  const ends_on = String(input.ends_on || starts_on);
  dayNumber(paid_on);
  const start = dayNumber(starts_on),
    end = dayNumber(ends_on);
  if (end < start || end - start > 3660)
    throw Error("Choose a valid coverage period, up to ten years.");
  const recurrence = String(input.recurrence || "none");
  if (!["none", "monthly", "yearly"].includes(recurrence))
    throw Error("Choose a valid recurrence.");
  const repeat_until = input.repeat_until ? String(input.repeat_until) : null;
  if (repeat_until && dayNumber(repeat_until) < start)
    throw Error("The recurrence end must follow its start.");
  const note = String(input.note || "").trim();
  if (note.length > 1000) throw Error("Keep notes under 1,000 characters.");
  return {
    name,
    category,
    amount_cents: cents,
    currency,
    paid_on,
    starts_on,
    ends_on,
    recurrence,
    repeat_until,
    note,
  };
}
function shiftMonth(date, months) {
  const d = new Date(`${date}T00:00:00Z`),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function expenseOccurrences(expense, endDate) {
  const out = [],
    stop = Math.min(
      dayNumber(endDate),
      expense.repeat_until ? dayNumber(expense.repeat_until) : Infinity,
    );
  const step =
    expense.recurrence === "monthly"
      ? 1
      : expense.recurrence === "yearly"
        ? 12
        : 0;
  for (let i = 0; i < 1200; i++) {
    const start = step
      ? shiftMonth(expense.starts_on, step * i)
      : expense.starts_on;
    const paid = step ? shiftMonth(expense.paid_on, step * i) : expense.paid_on;
    if (
      (dayNumber(start) > stop && dayNumber(paid) > dayNumber(endDate)) ||
      (expense.repeat_until &&
        dayNumber(start) > dayNumber(expense.repeat_until))
    )
      break;
    // Recurring expenses cover a full billing cycle. One-off expenses honor custom coverage.
    const end = step
      ? dateString(dayNumber(shiftMonth(expense.starts_on, step * (i + 1))) - 1)
      : expense.ends_on;
    out.push({
      start,
      end,
      paid,
      cents: expense.amount_cents,
      projected: i > 0,
    });
    if (!step) break;
  }
  return out;
}
export function allocatedCents(cents, from, through, rangeStart, rangeEnd) {
  const start = dayNumber(from),
    end = dayNumber(through),
    lo = Math.max(start, dayNumber(rangeStart)),
    hi = Math.min(end, dayNumber(rangeEnd));
  if (hi < lo) return 0;
  const days = end - start + 1;
  // Allocate fractional cents cumulatively, so adjacent periods sum to the exact invoice amount.
  return (
    Math.floor((cents * (hi - start + 1)) / days) -
    Math.floor((cents * (lo - start)) / days)
  );
}
export function expenseTotals(expenses, start, end, fx = { USD: 1 }) {
  let allocated = 0,
    cash = 0,
    missing = 0,
    projected = 0;
  const rows = expenses
    .filter((e) => !e.archived_at)
    .map((e) => {
      let a = 0,
        c = 0,
        p = 0;
      for (const o of expenseOccurrences(e, end)) {
        const share = allocatedCents(o.cents, o.start, o.end, start, end);
        a += share;
        if (o.paid >= start && o.paid <= end) c += o.cents;
        if (o.projected) p += share;
      }
      const rate = e.currency === "USD" ? 1 : Number(fx[e.currency]);
      const converted = Number.isFinite(rate) && rate > 0;
      if (!converted && (a || c)) missing++;
      if (converted) {
        allocated += Math.round(a * rate);
        cash += Math.round(c * rate);
        projected += Math.round(p * rate);
      }
      return {
        ...e,
        allocated_cents: a,
        cash_cents: c,
        usd_cents: converted ? Math.round(a * rate) : null,
        projected_cents: p,
      };
    });
  return {
    allocated_cents: allocated,
    cash_cents: cash,
    missing_fx: missing,
    projected_cents: projected,
    rows,
  };
}
export function groupError(message) {
  const raw =
    typeof message === "object"
      ? JSON.stringify(message)
      : String(message || "No error detail recorded");
  const clean = raw
    .replace(/https?:\/\/[^\s"']+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[id]")
    .replace(/\b(?:task_|run_)?[a-f0-9]{20,}\b/gi, "[id]")
    .replace(/\d+(?:\.\d+)?/g, (value, offset, whole) =>
      /(?:http|status|code)[\s"':=]*$/i.test(
        whole.slice(Math.max(0, offset - 18), offset),
      )
        ? value
        : "#",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  let category = "Other / unspecified";
  if (/insufficient|balance|credit.*enough/.test(clean))
    category = "Insufficient balance";
  else if (
    /safety|moderation|flagged|public figure|content.*review|sensitive|nsfw/.test(
      clean,
    )
  )
    category = "Content safety";
  else if (/size|megabyte|file.*large|maximum.*mb|limit.*mb/.test(clean))
    category = "File size limit";
  else if (/audio|codec|ffmpeg|decode/.test(clean))
    category = "Audio / media format";
  else if (/timeout|timed out|deadline/.test(clean)) category = "Timeout";
  else if (/concurr|rate.limit|too many|429/.test(raw.toLowerCase()))
    category = "Concurrency / rate limit";
  else if (/internal|provider|playground|service|upstream/.test(clean))
    category = "Provider error";
  return {
    category,
    key: clean.slice(0, 600),
    message: raw
      .replace(/https?:\/\/[^\s"']+/gi, "[url]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
      .slice(0, 700),
  };
}
