import {
  dateRange,
  todayYerevan,
  dayNumber,
  dateString,
  validateExpense,
  expenseOccurrences,
} from "./finance.mjs";
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const iconPaths = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  models: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  customers:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  wallet:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18m-6 5h6m-17-9V3h13v2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  cash: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  logout: '<path d="M9 4H4v16h5m6-13 5 5-5 5m-7-5h12"/>',
  alert: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v.1"/>',
  spark:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.overview}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
const num = (n) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n || 0),
  usd = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format((n || 0) / 1e6),
  cents = (n) => usd(n * 10000),
  pct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Yerevan",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const yerevanDay = (v) => dateFormatter.format(new Date(v));
const creditRange = (a, b) =>
  Math.abs((a || 0) - (b || 0)) < 0.0001 ? num(a) : `${num(a)}–${num(b)}`;
const reserveRange = (s) =>
  s.reserve_lower_micro === null
    ? "Unconfirmed"
    : s.reserve_lower_micro === s.reserve_upper_micro
      ? usd(s.reserve_lower_micro)
      : `${usd(s.reserve_lower_micro)}–${usd(s.reserve_upper_micro)}`;
const localPreview = ["127.0.0.1", "localhost", "[::1]"].includes(
  location.hostname,
);
const state = {
  data: null,
  range: dateRange("week"),
  page: "overview",
  activity: "models",
  search: "",
  tablePage: 0,
  errorCategory: "all",
  expenseView: "active",
  client: null,
  request: 0,
  loading: false,
};
const headings = {
  overview: [
    "Overview",
    "A little clarity. Every day.",
    "Your sales, your spending, and what stays.",
  ],
  activity: [
    "Activity",
    "See what is happening.",
    "Usage, costs and the errors worth fixing.",
  ],
  customers: [
    "Customers & credits",
    "The customers behind the numbers.",
    "Purchases, usage and the credits still in their wallets.",
  ],
  expenses: [
    "Expenses",
    "Every expense. In its place.",
    "From a blogger partnership to your monthly AI tools.",
  ],
};
function message(text) {
  $("#message").textContent = text;
  $("#message").hidden = !text;
}
function detail(title, html) {
  $("#detail-title").textContent = title;
  $("#detail-content").innerHTML = html;
  $("#detail-dialog").showModal();
}
function buttonBusy(button, busy, label) {
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span> Saving…' : label;
}
async function api(options = {}) {
  const query = new URLSearchParams(state.range);
  let token = "";
  if (!localPreview) {
    const { data } = await state.client.auth.getSession();
    token = data.session?.access_token || "";
  }
  const response = await fetch(
    `/.netlify/functions/business-dashboard${options.method ? "" : "?" + query}`,
    {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  const body = await response
    .json()
    .catch(() => ({ error: "Invalid server response." }));
  if (!response.ok) {
    if ([401, 403].includes(response.status)) {
      state.data = null;
      $("#page").innerHTML = "";
      if (response.status === 401 && !localPreview)
        $("#login-dialog").showModal();
    }
    throw Error(body.error || "The dashboard could not load.");
  }
  return body;
}
async function load() {
  const request = ++state.request;
  state.loading = true;
  $("#export").disabled = true;
  $("#page").classList.add("loading-overlay");
  $("#refresh").disabled = true;
  message("");
  $("#period-label").textContent = `${state.range.start} — ${state.range.end}`;
  try {
    const data = await api();
    if (request !== state.request) return;
    state.data = data;
    state.tablePage = 0;
    render();
    $("#updated-label").textContent =
      `Updated ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit" }).format(new Date(data.generated_at))} · Armenia time`;
    $("#connection-state").textContent = localPreview
      ? "Local private preview"
      : "Verified owner";
  } catch (error) {
    if (request === state.request) {
      state.data = null;
      $("#page").innerHTML =
        `<div class="panel empty"><div class="empty-art">${icon("lock")}</div><h3>Let’s reconnect.</h3><p>${esc(error.message)}</p><button class="button primary" data-action="retry-load">Try again</button></div>`;
      message(error.message);
    }
  } finally {
    if (request === state.request) {
      state.loading = false;
      $("#page").classList.remove("loading-overlay");
      $("#refresh").disabled = false;
    }
  }
}
function metric(label, value, foot, action, featured = false, small = false) {
  return `<article class="metric ${featured ? "featured" : ""}" ${action ? `role="button" tabindex="0" data-action="${action}" aria-label="${esc(label)} details"` : ""}><div class="metric-label">${esc(label)}${icon(action === "sales" ? "cash" : action === "profit" ? "spark" : action === "cost" ? "models" : "overview")}</div><div class="metric-value ${small ? "small" : ""}">${value}</div><div class="metric-bottom"><div class="metric-foot">${foot}</div>${action ? '<span class="metric-arrow">↗</span>' : ""}</div></article>`;
}
const head = (title, subtitle, extra = "") =>
  `<div class="panel-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${extra}</div>`;
const flow = (name, value, extra = "") =>
  `<div class="flow-row ${extra}"><span>${name}</span><span>${value}</span></div>`;
function chart() {
  const rows = state.data.daily,
    grouped = [];
  const bucket =
    rows.length > 120 ? Math.ceil(rows.length / 30) : rows.length > 35 ? 7 : 1;
  for (let i = 0; i < rows.length; i += bucket) {
    const chunk = rows.slice(i, i + bucket);
    grouped.push({
      day: chunk[0].day,
      end: chunk.at(-1).day,
      sales: chunk.reduce((s, r) => s + r.sales_micro, 0),
      cost: chunk.reduce((s, r) => s + r.cost_micro, 0),
    });
  }
  const max = Math.max(1, ...grouped.flatMap((d) => [d.sales, d.cost])) / 1e6,
    step = Math.max(1, Math.ceil(max / 4 / 10) * 10),
    top = step * 4,
    w = 590 / Math.max(1, grouped.length);
  return `<svg class="chart" viewBox="0 0 660 270" role="img" aria-label="Daily sales and known generation costs">${[0, 1, 2, 3, 4].map((i) => `<line class="grid" x1="58" x2="650" y1="${225 - i * 47}" y2="${225 - i * 47}"/><text x="6" y="${229 - i * 47}">$${num(i * step)}</text>`).join("")}${grouped
    .map((d, i) => {
      const x = 60 + i * w,
        b = Math.max(1, Math.min(19, w * 0.34)),
        a = (d.sales / 1e6 / top) * 188,
        c = (d.cost / 1e6 / top) * 188,
        label = d.day.slice(5).replace("-", "/");
      return `<g><rect x="${x + 2}" y="${225 - a}" width="${b}" height="${a}" rx="2"/><rect class="cost" x="${x + b + 5}" y="${225 - c}" width="${b}" height="${c}" rx="2"/>${i % Math.max(1, Math.ceil(grouped.length / 8)) === 0 ? `<text x="${x + 5}" y="248">${label}</text>` : ""}<rect class="chart-hit" x="${x}" y="25" width="${w}" height="205"><title>${d.day}${d.end !== d.day ? " to " + d.end : ""}: sales ${usd(d.sales)}, known API cost ${usd(d.cost)}</title></rect></g>`;
    })
    .join("")}</svg>`;
}
function issuesBanner() {
  const issues = state.data.issues;
  if (!issues.length) return "";
  return `<div class="callout"><div><strong>Some totals are provisional.</strong><p>Some costs or payment details are unconfirmed. Profit stays provisional.</p></div><button class="button subtle" data-action="quality">Review data ↗</button></div>`;
}
function overview() {
  const d = state.data,
    s = d.summary;
  return `<div class="metrics">${metric(s.unconverted_payments ? "Sales subtotal" : "Sales revenue", usd(s.sales_micro), `${num(s.payments)} payments${s.unconverted_payments ? " · " + num(s.unconverted_payments) + " not in USD subtotal" : " · tax excluded"}`, "sales", true)}${metric("Registrations", num(s.registrations), "Registered accounts in this period", "registrations")}${metric("Known API costs", usd(s.cost_micro + s.internal_cost_micro), `${s.unpriced_jobs + s.internal_unpriced ? num(s.unpriced_jobs + s.internal_unpriced) + " jobs unpriced" : "Rate-based estimate"}`, "cost")}${metric("Estimated profit", "Needs reconciliation", "Open the calculation to see what’s missing", "profit", false, true)}</div>
+<div class="support-strip"><button data-action="buyers">${icon("customers")}<span><strong>${num(s.buyers)}</strong>paying customers</span></button><button data-action="used-buyers">${icon("wallet")}<span><strong>${num(s.used_buyers)}</strong>buyers used credits</span></button><button data-action="nonbuyer">${icon("spark")}<span><strong>${usd(s.nonbuyer_cost_micro)}</strong>nonbuyer usage cost*</span></button><button data-action="errors">${icon("alert")}<span><strong>${num(s.failed)} <small class="quiet">${pct(s.failure_rate)}</small></strong>failed generations</span></button></div>
+${issuesBanner()}<div class="grid-2"><article class="panel">${head("Money in. Generation costs out.", "Daily totals for your selected period.")}<div class="chart-legend"><span><i></i>Sales revenue</span><span><i class="spent"></i>Known API cost</span></div><div class="chart-wrap">${chart()}</div></article><article class="panel">${head("What stays", "Cash view · includes expenses paid in this period")}<div class="flow">${flow("Sales excluding tax", usd(s.sales_micro))}${flow("Recorded refunds", "− " + usd(s.refunds_micro))}${flow("Estimated payment fees", "− " + usd(s.fees_micro))}${flow("Known customer API costs", "− " + usd(s.cost_micro))}${flow("Known internal API costs", "− " + usd(s.internal_cost_micro))}${flow("Expenses paid / scheduled", "− " + cents(s.expense_cash_cents))}${flow("After known costs", usd(s.cash_after_known_costs_micro), "total")}${flow("Incomplete cash-flow estimate", "Not final profit", "sub")}</div><div class="info-note">Unused credits can create future costs. Unconfirmed costs and refunds are not silently treated as zero. <button class="action-link" data-action="profit">See the calculation ↗</button></div></article></div>
+<div class="bottom-grid"><article class="panel">${head("Customer credits still held", "Current wallet balances · across all recorded buyers", '<a class="text-link" href="#customers">View customers ↗</a>')}<div class="panel-body"><div class="large-inline">${num(s.buyer_balance)}<small>credits</small></div><p class="source-note">Includes purchased, gift and trial credits. Purchased-package bounds: ${creditRange(s.package_balance_lower, s.package_balance_upper)} credits. Includes package bonuses.</p><p class="source-note">Future cost scenario: <strong>${reserveRange(s)}</strong> at the selected period’s known usage mix. Future model choices may change this.</p><div class="split-stats"><div><b>${num(s.credits_debited)}</b>Credits debited this period</div><div><b>${num(s.credits_refunded)}</b>Credits refunded</div></div></div></article><article class="panel">${head("Your other expenses", "Expenses allocated to this reporting period", '<a class="text-link" href="#expenses">Manage expenses ↗</a>')}<div class="panel-body"><div class="large-inline">${cents(s.expense_allocated_cents)}<small>for this period</small></div><p class="source-note">${s.expense_projected_cents ? cents(s.expense_projected_cents) + " is scheduled recurring expense." : "One-time expenses and covered periods are calculated separately from payment dates."}</p><button class="button primary" data-action="add-expense">+ Add an expense</button></div></article></div>`.replace(
    /^\+/gm,
    "",
  );
}
function table(headers, rows, empty = "No records in this period.") {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
function activity() {
  const d = state.data,
    s = d.summary;
  const tabs = `<div class="tabs">${[
    ["models", "Models & usage"],
    ["errors", "Failed generations"],
    ["sources", "Sources"],
  ]
    .map(
      ([id, name]) =>
        `<button class="${state.activity === id ? "active" : ""}" data-tab="${id}">${name}${id === "errors" ? ` · ${num(s.failed)}` : ""}</button>`,
    )
    .join("")}</div>`;
  if (state.activity === "errors") {
    const categories = [...new Set(d.errors.map((e) => e.category))];
    const filtered = d.errors.filter(
      (e) =>
        (state.errorCategory === "all" || e.category === state.errorCategory) &&
        `${e.provider} ${e.model} ${e.message} ${e.category}`
          .toLowerCase()
          .includes(state.search.toLowerCase()),
    );
    return (
      tabs +
      `<div class="metrics">${metric("Failed generations", num(s.failed), "Terminal failed attempts", "errors")}${metric("Failure rate", pct(s.failure_rate), "Failed / successful + failed", "errors")}${metric("Similar error groups", num(d.errors.length), "Normalized within the same model", "errors")}${metric("Credits refunded", num(s.credits_refunded), "Customer refunds · not provider refunds", "refunds")}</div><article class="panel">${head("Find the recurring problem", "IDs and changing numeric values are normalized. Click a row for details.")}<div class="table-tools"><input id="table-search" aria-label="Search errors" placeholder="Search model or error…" value="${esc(state.search)}"><select id="error-category" aria-label="Error category"><option value="all">All categories</option>${categories.map((c) => `<option ${state.errorCategory === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>${table(
        [
          "Error group / model",
          "Failures",
          "Users",
          "First / latest",
          "Refunded credits",
        ],
        filtered.map(
          (e) =>
            `<tr data-error="${d.errors.indexOf(e)}" tabindex="0"><td class="wrap-cell"><span class="data-chip amber">${esc(e.category)}</span><div class="model-name" style="margin-top:7px">${esc(e.provider)}</div><div class="provider">${esc(e.message)}</div></td><td>${num(e.count)}</td><td>${num(e.users)}</td><td>${esc(yerevanDay(e.first))}<div class="date-line">${esc(yerevanDay(e.last))}</div></td><td>${num(e.credits_refunded)}</td></tr>`,
        ),
      )}<p class="table-note">Recovered retries: historical retry links are incomplete. A later similar success is not counted as a confirmed recovery. ${s.failed_unpriced ? num(s.failed_unpriced) + " failed jobs also have unconfirmed provider cost." : ""}</p></article>`
    );
  }
  if (state.activity === "sources")
    return (
      tabs +
      `<div class="grid-2"><article class="panel">${head("Where generations happen", "Usage surface does not prove acquisition source.")}${table(
        ["Surface", "Generations", "Known API cost", "Unpriced jobs"],
        d.surfaces.map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${num(r.generations)}</td><td>${usd(r.cost_micro)}</td><td>${num(r.unpriced)}</td></tr>`,
        ),
      )}</article><article class="panel">${head("Advertising spending", "Allocate blogger and campaign expenses by coverage dates.")}<div class="panel-body"><div class="large-inline">${cents(d.expenses.filter((e) => e.category === "advertising").reduce((a, e) => a + (e.usd_cents || 0), 0))}</div><p class="source-note">Channel attribution needs matching campaign IDs. Advertising costs are not assigned to a revenue channel by guessing.</p><a class="button primary" href="#expenses">Manage expenses</a></div></article></div><article class="panel">${head("Recorded acquisition sources", "Missing tracking remains unknown. These are incomplete channel totals, not final channel profit.")}${table(
        [
          "Source",
          "Payments",
          "Known sales",
          "Known API cost",
          "Nonbuyer API cost",
          "Unpriced jobs",
        ],
        d.channels.map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${num(r.payments)}</td><td>${usd(r.sales_micro)}</td><td>${usd(r.cost_micro)}</td><td>${usd(r.nonbuyer_cost_micro)}</td><td>${num(r.unpriced)}</td></tr>`,
        ),
      )}</article>`
    );
  const models = d.models.filter((r) =>
    `${r.provider} ${r.model} ${r.resolution}`
      .toLowerCase()
      .includes(state.search.toLowerCase()),
  );
  return (
    tabs +
    `<div class="support-strip"><button data-action="cost"><span><strong>${num(s.successful)}</strong>successful</span></button><button data-action="errors"><span><strong>${num(s.failed)}</strong>failed</span></button><button data-action="pending"><span><strong>${num(s.pending)}</strong>in progress</span></button><button data-action="nonbuyer"><span><strong>${num(s.nonbuyer_generations)}</strong>nonbuyer attempts*</span></button></div><article class="panel">${head("Model breakdown", "Customer usage · internal testing is separated.")}<div class="table-tools"><input id="table-search" aria-label="Search models" placeholder="Search models…" value="${esc(state.search)}"><button class="button subtle" data-action="rates">Edit provider rates</button></div>${table(
      [
        "Model / configuration",
        "Successful",
        "Failed",
        "Known API cost",
        "Unpriced",
        "Credits debited",
      ],
      models.map(
        (r) =>
          `<tr><td><div class="model-name">${esc(r.provider)}</div><div class="provider">${esc(r.model)} · ${esc(r.resolution)}</div></td><td>${num(r.done)}</td><td>${num(r.failed)}</td><td>${usd(r.cost_micro)}</td><td class="${r.unknown ? "text-amber" : ""}">${num(r.unknown)}</td><td>${num(r.credits)}</td></tr>`,
      ),
    )}<p class="table-note">${num(s.unknown_status)} jobs have an unrecognized status. Known API cost includes recorded costs or explicit rate estimates. ${usd(s.internal_cost_micro)} internal cost and ${num(s.internal_unpriced)} unpriced internal jobs are separated.</p></article>`
  );
}
function customers() {
  const d = state.data,
    s = d.summary,
    filtered = d.buyers.filter((b) =>
      `${b.email} ${b.user_id}`
        .toLowerCase()
        .includes(state.search.toLowerCase()),
    ),
    pageRows = filtered.slice(state.tablePage * 30, (state.tablePage + 1) * 30);
  return `<div class="metrics">${metric("Paying customers", num(s.buyers), "Selected reporting period", "buyers", true)}${metric("Buyers using credits", num(s.used_buyers), "Successful jobs after a recorded purchase", "used-buyers")}${metric("Current buyer wallets", num(s.buyer_balance), "Includes gifts and trial credits", "balances")}${metric("Purchased-package credits", creditRange(s.package_balance_lower, s.package_balance_upper), "Bounds from the credit ledger · includes bonuses", "balances", false, true)}</div><article class="panel">${head("Customers & current balances", "Wallet balances are current; usage is filtered to your selected dates.")}<div class="table-tools"><input id="table-search" aria-label="Search customers" placeholder="Search email…" value="${esc(state.search)}"><span class="quiet">${num(filtered.length)} recorded buyers</span></div>${table(
    [
      "Customer",
      "Purchases through end date",
      "Package credits issued",
      "Current wallet",
      "Package balance bounds",
      "Period jobs / debits",
      "Known period API cost",
    ],
    pageRows.map(
      (b) =>
        `<tr><td class="wrap-cell"><div class="model-name">${esc(b.email || b.user_id)}</div><div class="provider">First payment ${esc(String(b.first_payment || "").slice(0, 10))}</div></td><td>${num(b.payments)}</td><td>${num(b.package_credits)}</td><td>${num(b.balance_credits)}</td><td>${creditRange(b.package_balance?.lower, b.package_balance?.upper)}<div class="date-line">${b.package_balance?.reconciled ? "Reconciled" : "Conservative bounds"}</div></td><td>${num(b.generations)} / ${num(b.credits_used)}</td><td>${usd(b.cost_micro)}${b.unknown ? `<div class="date-line text-amber">${num(b.unknown)} unpriced</div>` : ""}</td></tr>`,
    ),
  )}<div class="table-pagination"><span>${num(filtered.length)} customers · page ${state.tablePage + 1}</span><span><button class="button subtle" data-action="prev-page" ${state.tablePage === 0 ? "disabled" : ""}>Previous</button> <button class="button subtle" data-action="next-page" ${(state.tablePage + 1) * 30 >= filtered.length ? "disabled" : ""}>Next</button></span></div></article><div class="info-note" style="margin:20px 0">Package credits include any bonus granted with the payment. Current wallets may include free credits and subscription grants. The package balance is shown as a conservative range where debit provenance is ambiguous. Future cost scenario: ${reserveRange(s)}, based on the selected period’s known cost per charged credit.</div>`;
}
const categories = {
  advertising: "Advertising",
  software: "Software / AI",
  hosting: "Hosting",
  contractor: "Contractor",
  other: "Other",
};
function expenses() {
  const d = state.data,
    s = d.summary,
    archived = state.expenseView === "archived",
    rows = (archived ? d.archived_expenses || [] : d.expenses).filter((e) =>
      `${e.name} ${e.category} ${e.note}`
        .toLowerCase()
        .includes(state.search.toLowerCase()),
    );
  return `<div class="expense-overview">${metric("Expenses for this period", cents(s.expense_allocated_cents), "Allocated across covered days", null, true)}${metric("Paid / scheduled payments", cents(s.expense_cash_cents), "Full amounts on payment dates · renewals projected")}${metric("Scheduled renewals", cents(s.expense_projected_cents), "Included above · not confirmed invoices")}</div><article class="panel">${head("The cost of running Hansora", "A clear place for every partnership, tool and invoice.", '<button class="button primary" data-action="add-expense">+ Add expense</button>')}<div class="table-tools"><input id="table-search" aria-label="Search expenses" placeholder="Find an expense…" value="${esc(state.search)}"><div class="segmented"><button data-expense-view="active" class="${!archived ? "active" : ""}">Active</button><button data-expense-view="archived" class="${archived ? "active" : ""}">Archived</button></div></div>${
    rows.length
      ? table(
          ["Expense", "Amount / schedule", "Period covered", "This period", ""],
          rows.map(
            (e) =>
              `<tr><td class="wrap-cell"><div class="model-name">${esc(e.name)}</div><div class="provider category"><i class="category-dot ${esc(e.category)}"></i>${esc(categories[e.category] || e.category)}</div>${e.note ? `<div class="date-line">${esc(e.note)}</div>` : ""}</td><td>${esc(e.currency)} ${num(e.amount_cents / 100)}<div class="date-line">${e.recurrence === "none" ? "One time" : e.recurrence === "monthly" ? "Monthly renewal" : "Yearly renewal"}</div></td><td>${esc(e.starts_on)} → ${esc(e.ends_on)}<div class="date-line">Paid ${esc(e.paid_on)}</div></td><td>${archived ? "—" : e.usd_cents === null ? '<span class="text-amber">Needs FX rate</span>' : cents(e.usd_cents)}${e.projected_cents ? '<div class="date-line">Includes scheduled renewals</div>' : ""}</td><td>${archived ? `<button class="action-link" data-restore="${esc(e.id)}">Restore</button>` : `<button class="action-link" data-edit="${esc(e.id)}">Edit</button><button class="action-link" data-archive="${esc(e.id)}">Archive</button>`}</td></tr>`,
          ),
        )
      : `<div class="empty"><div class="empty-art">${icon("wallet")}</div><h3>${archived ? "No archived expenses." : "Start with your first expense."}</h3><p>${archived ? "Archived expenses remain recoverable here." : "Blogger campaigns, AI tools, hosting, contractors. Put the amount and the period in once."}</p>${!archived ? '<button class="button primary" data-action="add-expense">+ Add expense</button>' : ""}</div>`
  }<p class="table-note">Allocations conserve every cent across covered days. Scheduled renewals are projections until their amounts are confirmed. Annual subscriptions spread over their billing period; the cash view keeps their actual payment date.</p></article>`;
}
function render() {
  if (!state.data) return;
  const page = location.hash.slice(1);
  state.page = headings[page] ? page : "overview";
  const [name, title, subtitle] = headings[state.page];
  $("#breadcrumb").textContent = name;
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === state.page);
    if (a.dataset.page === state.page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#page").innerHTML = { overview, activity, customers, expenses }[
    state.page
  ]();
  $("#export").disabled = false;
}
function openExpense(id) {
  const f = $("#expense-form");
  f.reset();
  const e = state.data.expenses.find((e) => e.id === id);
  $("#expense-title").textContent = e ? "Edit expense" : "Add an expense";
  const today = todayYerevan();
  const defaults = e
    ? { ...e, amount: (e.amount_cents / 100).toFixed(2) }
    : {
        id: "",
        currency: "USD",
        paid_on: today,
        starts_on: today,
        ends_on: today,
        recurrence: "none",
      };
  for (const [key, value] of Object.entries(defaults)) {
    if (f.elements.namedItem(key))
      f.elements.namedItem(key).value = value ?? "";
  }
  $("#repeat-until-label").hidden = f.elements.recurrence.value === "none";
  syncCoverage();
  $("#expense-error").textContent = "";
  $("#expense-dialog").showModal();
}
function fxRow(currency = "", rate = "") {
  return `<div class="inline-fields"><input aria-label="Currency code" class="fx-code" maxlength="3" placeholder="EUR" value="${esc(currency)}"><input class="fx-value" aria-label="USD per currency unit" inputmode="decimal" placeholder="USD per 1 unit" value="${esc(rate)}"><button type="button" class="icon-button" data-remove-row aria-label="Remove currency">×</button></div>`;
}
function rateRow(r = {}) {
  return `<div class="rate-row"><button type="button" class="action-link" data-remove-row>Remove</button><label>Exact model ID<input data-rate="model" placeholder="e.g. grok-imagine/text-to-video" value="${esc(r.model || "")}"></label><div class="form-row"><label>Resolution <small>(blank = all)</small><input data-rate="resolution" placeholder="720p" value="${esc(r.resolution || "")}"></label><label>USD per unit<input data-rate="rate" inputmode="decimal" placeholder="0.0225" value="${esc(r.rate ?? "")}"></label></div><div class="form-row"><label>Unit<select data-rate="unit">${[
    ["job", "Completed job"],
    ["second", "Output second"],
    ["billable_second", "Billable second"],
    ["character", "Character"],
  ]
    .map(
      ([id, text]) =>
        `<option value="${id}" ${(r.unit || "job") === id ? "selected" : ""}>${text}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Effective from<input data-rate="from" type="date" value="${esc(r.from || todayYerevan())}"></label></div><label>Through <small>(optional)</small><input data-rate="to" type="date" value="${esc(r.to || "")}"></label></div>`;
}
function openSettings() {
  if (state.loading) return;
  const settings = state.data.settings || {};
  $("#fx-fields").innerHTML =
    Object.entries(settings.fx || {})
      .filter(([c]) => c !== "USD")
      .map(([c, v]) => fxRow(c, v))
      .join("") || fxRow();
  $("#rate-fields").innerHTML = (settings.rates || []).map(rateRow).join("");
  $("#settings-error").textContent = "";
  $("#settings-dialog").showModal();
}
function explain(action) {
  const d = state.data,
    s = d.summary;
  let title = "Details",
    html = "";
  if (action === "sales") {
    title = "Sales & payments";
    html =
      `<p class="detail-description">${esc(d.methodology.sales)} Payment fees remain estimates until reconciled with Dodo statements. Refunds are attached to purchase cohorts; their actual cash refund dates are not reconstructed.</p>` +
      table(
        ["Date", "Currency / amount", "Known sales", "Fee estimate"],
        d.payments.map(
          (p) =>
            `<tr><td>${esc(p.day)}</td><td>${esc(p.money.currency)}</td><td>${p.money.known ? usd(p.money.revenue_micro) : '<span class="text-amber">Unconverted</span>'}</td><td>${p.money.known ? usd(p.money.fee_micro) : "—"}</td></tr>`,
        ),
      );
  } else if (action === "profit") {
    title = "What we can calculate today";
    html = `<p class="detail-description">${esc(d.methodology.profit)}</p><div class="detail-list">${flow("Known sales excluding tax", usd(s.sales_micro))}${flow("Recorded refunds", "− " + usd(s.refunds_micro))}${flow("Payment fees · estimated", "− " + usd(s.fees_micro))}${flow("Known customer + internal API costs", "− " + usd(s.cost_micro + s.internal_cost_micro))}${flow("Expenses paid / scheduled", "− " + cents(s.expense_cash_cents))}${flow("Cash after known costs", usd(s.cash_after_known_costs_micro), "strong")}${flow("Expenses allocated to the period", cents(s.expense_allocated_cents))}</div><h3>Before calling this profit</h3><p class="detail-description">Reconcile unknown provider costs, currency conversions, refunds and the paid/gift credit ledger. A full wallet reserve must not simply be subtracted from today’s sales.</p><button class="button subtle" data-action="quality">Review missing data</button>`;
  } else if (action === "quality") {
    title = "Data quality & calculation notes";
    html = `<div class="detail-list">${d.issues.map((i) => `<div class="flow-row"><span class="text-amber">${esc(i.label)}</span></div>`).join("") || "<p>No additional data alerts for this period.</p>"}</div><h3>How the numbers work</h3>${Object.entries(
      d.methodology,
    )
      .map(
        ([key, value]) =>
          `<p class="detail-description"><strong>${esc(key.replace(/^./, (c) => c.toUpperCase()))}</strong><br>${esc(value)}</p>`,
      )
      .join(
        "",
      )}<button class="button primary" data-action="rates">Review rate settings</button>`;
  } else if (action === "nonbuyer") {
    title = "Free / nonbuyer usage";
    html = `<p class="detail-description">${esc(d.methodology.nonbuyer)}</p><div class="detail-list">${flow("Nonbuyer generation attempts", num(s.nonbuyer_generations))}${flow("Known provider cost", usd(s.nonbuyer_cost_micro))}${flow("Unpriced completed/failed jobs", num(s.nonbuyer_unpriced))}</div><p class="detail-description">After-purchase gift and free credits cannot yet be isolated exactly. The label stays “nonbuyer” to avoid claiming a precise free-trial total.</p>`;
  } else if (action === "refunds") {
    title = "Customer credit refunds";
    html = `<div class="detail-list">${flow("Credits refunded this period", num(s.credits_refunded))}</div><p class="detail-description">Customer credits returned and provider dollars returned are different events. A customer refund is never used as evidence that the provider charged zero.</p>`;
  } else if (action === "registrations") {
    title = "Registrations";
    html =
      `<p class="detail-description">Registered profiles created during the selected dates, using Armenia time. Your owner and confirmed employee accounts are excluded.</p>` +
      table(
        ["Day", "New registrations"],
        d.daily.map(
          (r) => `<tr><td>${r.day}</td><td>${num(r.registrations)}</td></tr>`,
        ),
      );
  } else if (action === "balances") {
    title = "Unused credits & future cost";
    html = `<div class="detail-list">${flow("Current buyer wallet balance", num(s.buyer_balance) + " credits")}${flow("Purchased-package credit bounds", creditRange(s.package_balance_lower, s.package_balance_upper))}${flow("Future-cost scenario", reserveRange(s))}</div><p class="detail-description">${esc(d.methodology.credits)} Balances are current snapshots even when viewing an older reporting period. Model choices and credit provenance must be known before an exact future-cost reserve can be shown.</p>`;
  } else if (action === "pending") {
    title = "Jobs still in progress";
    html = `<div class="detail-list">${flow("In progress", num(s.pending))}${flow("Unrecognized status", num(s.unknown_status))}</div><p class="detail-description">Pending jobs are excluded from terminal failure rates. They may incur provider costs later.</p>`;
  } else if (action === "buyers" || action === "used-buyers") {
    location.hash = "customers";
    return;
  } else if (action === "cost") {
    location.hash = "activity";
    state.activity = "models";
    render();
    return;
  } else if (action === "errors") {
    location.hash = "activity";
    state.activity = "errors";
    render();
    return;
  }
  detail(title, html);
}
$("#page").addEventListener("click", handleClick);
$("#detail-dialog").addEventListener("click", handleClick);
function handleClick(e) {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    state.activity = tab.dataset.tab;
    state.search = "";
    render();
    return;
  }
  const page = e.target.closest("[data-expense-view]");
  if (page) {
    state.expenseView = page.dataset.expenseView;
    render();
    return;
  }
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    openExpense(edit.dataset.edit);
    return;
  }
  const err = e.target.closest("[data-error]");
  if (err) {
    const r = state.data.errors[Number(err.dataset.error)];
    detail(
      r.category,
      `<p class="detail-description">${esc(r.provider)} · ${esc(r.model)}</p><div class="detail-list">${flow("Failed attempts", num(r.count))}${flow("Affected users", num(r.users))}${flow("First recorded", esc(r.first))}${flow("Latest recorded", esc(r.last))}${flow("Recorded customer credit refunds", num(r.credits_refunded))}${flow("Failed rows with a playable result", num(r.has_result))}<pre>${esc(r.message)}</pre></div><p class="detail-description">This is a similarity group: changing IDs, numbers and URLs are normalized. It does not prove a single technical root cause. Retry recovery is unconfirmed without explicit links.</p>`,
    );
    return;
  }
  const archive = e.target.closest("[data-archive], [data-restore]");
  if (archive) {
    archiveExpense(
      archive.dataset.archive || archive.dataset.restore,
      !!archive.dataset.restore,
      archive,
    );
    return;
  }
  const a = e.target.closest("[data-action]")?.dataset.action;
  if (!a) return;
  if (a === "add-expense") openExpense();
  else if (a === "rates") {
    if ($("#detail-dialog").open) $("#detail-dialog").close();
    openSettings();
  } else if (a === "retry-load") load();
  else if (a === "prev-page" || a === "next-page") {
    state.tablePage += a === "next-page" ? 1 : -1;
    render();
  } else {
    if ($("#detail-dialog").open) $("#detail-dialog").close();
    explain(a);
  }
}
$("#page").addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches("[role=button],[data-error]")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
let searchTimer;
$("#page").addEventListener("input", (e) => {
  if (e.target.id === "table-search") {
    const pos = e.target.selectionStart;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      state.tablePage = 0;
      render();
      const input = $("#table-search");
      input?.focus();
      input?.setSelectionRange(pos, pos);
    }, 180);
  }
});
$("#page").addEventListener("change", (e) => {
  if (e.target.id === "error-category") {
    state.errorCategory = e.target.value;
    render();
  }
});
async function archiveExpense(id, restore, button) {
  button.disabled = true;
  try {
    await api({
      method: "POST",
      body: JSON.stringify({
        action: restore ? "restore_expense" : "archive_expense",
        id,
      }),
    });
    await load();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
}
$("#expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("#save-expense"),
    raw = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const expense = validateExpense(raw);
    buttonBusy(button, true);
    await api({
      method: "POST",
      body: JSON.stringify({
        action: "save_expense",
        id: raw.id || undefined,
        expense,
      }),
    });
    $("#expense-dialog").close();
    await load();
  } catch (error) {
    $("#expense-error").textContent = error.message;
  } finally {
    buttonBusy(button, false, "Save expense");
  }
});
function syncCoverage() {
  const f = $("#expense-form"),
    recurrence = f.elements.recurrence.value;
  f.elements.ends_on.readOnly = recurrence !== "none";
  if (recurrence !== "none" && f.elements.starts_on.value) {
    const start = f.elements.starts_on.value;
    f.elements.ends_on.value =
      expenseOccurrences(
        {
          starts_on: start,
          ends_on: start,
          paid_on: f.elements.paid_on.value || start,
          recurrence,
          amount_cents: 1,
        },
        start,
      )[0]?.end || start;
  }
}
$("#expense-form [name=starts_on]").addEventListener("change", syncCoverage);
$("#expense-form [name=recurrence]").addEventListener("change", (e) => {
  syncCoverage();
  $("#repeat-until-label").hidden = e.target.value === "none";
  $("#allocation-hint").textContent =
    e.target.value === "none"
      ? "The expense is spread across its covered days; cash is counted on the payment date."
      : "Renewals are projected for full billing cycles from the start date. Confirm actual amounts as invoices arrive.";
});
$("#expense-form [name=paid_on]").addEventListener("change", (e) => {
  const f = $("#expense-form");
  if (!f.elements.id.value) {
    f.elements.starts_on.value = e.target.value;
    f.elements.ends_on.value = e.target.value;
    syncCoverage();
  }
});
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("#settings-button").onclick = () => state.data && openSettings();
$("#mobile-settings").onclick = () => state.data && openSettings();
$("#add-fx").onclick = () =>
  $("#fx-fields").insertAdjacentHTML("beforeend", fxRow());
$("#add-rate").onclick = () =>
  $("#rate-fields").insertAdjacentHTML("afterbegin", rateRow());
$("#settings-dialog").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove-row]");
  if (b) b.closest(".rate-row,.inline-fields").remove();
});
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fx = {},
    rates = [];
  for (const row of document.querySelectorAll("#fx-fields .inline-fields")) {
    const currency = row.querySelector(".fx-code").value.trim().toUpperCase(),
      value = row.querySelector(".fx-value").value.trim();
    if (currency && value) fx[currency] = Number(value);
  }
  for (const row of document.querySelectorAll("#rate-fields .rate-row")) {
    const r = {};
    row
      .querySelectorAll("[data-rate]")
      .forEach((input) => (r[input.dataset.rate] = input.value));
    r.rate = Number(r.rate);
    rates.push(r);
  }
  const button = $("#save-settings");
  try {
    buttonBusy(button, true);
    await api({
      method: "POST",
      body: JSON.stringify({
        action: "save_settings",
        settings: { fx, rates },
      }),
    });
    $("#settings-dialog").close();
    await load();
  } catch (error) {
    $("#settings-error").textContent = error.message;
  } finally {
    buttonBusy(button, false, "Save calculations");
  }
});
$("#refresh").onclick = load;
$("#period").onchange = () => {
  const preset = $("#period").value;
  $("#custom-dates").hidden = preset !== "custom";
  if (preset === "custom") {
    $("#range-start").value = state.range.start;
    $("#range-end").value = state.range.end;
    return;
  }
  state.range = dateRange(preset);
  load();
};
$("#custom-dates").onsubmit = (e) => {
  e.preventDefault();
  try {
    const start = $("#range-start").value,
      end = $("#range-end").value;
    if (
      dayNumber(end) < dayNumber(start) ||
      dayNumber(end) - dayNumber(start) > 366
    )
      throw Error("Choose up to 367 days, with the end after the start.");
    state.range = { start, end };
    load();
  } catch (error) {
    message(error.message);
  }
};
window.addEventListener("hashchange", () => {
  state.search = "";
  state.tablePage = 0;
  render();
});
$("#export").onclick = () => {
  if (!state.data) return;
  const d = state.data,
    s = d.summary,
    rows = [
      [
        "Hansora owner report",
        `${state.range.start} through ${state.range.end}`,
      ],
      ["Metric", "USD / count"],
      ["Sales excluding tax", s.sales_micro / 1e6],
      ["Payment fees ESTIMATE", s.fees_micro / 1e6],
      ["Known API costs", s.cost_micro / 1e6],
      ["Unpriced jobs", s.unpriced_jobs],
      ["Internal known costs", s.internal_cost_micro / 1e6],
      ["Expenses paid", s.expense_cash_cents / 100],
      ["Expenses allocated", s.expense_allocated_cents / 100],
      [
        "Cash after KNOWN costs (NOT FINAL PROFIT)",
        s.cash_after_known_costs_micro / 1e6,
      ],
      ["Final profit", "UNRECONCILED"],
      ["Registrations", s.registrations],
      ["Successful jobs", s.successful],
      ["Failed jobs", s.failed],
      [],
      ["Model", "Resolution", "Done", "Failed", "Known USD", "Unpriced"],
      ...d.models.map((m) => [
        m.provider,
        m.resolution,
        m.done,
        m.failed,
        m.cost_micro / 1e6,
        m.unknown,
      ]),
      [],
      [
        "Expenses",
        "Currency",
        "Invoice amount",
        "Allocated USD",
        "Starts",
        "Ends",
        "Recurrence",
      ],
      ...d.expenses.map((e) => [
        e.name,
        e.currency,
        e.amount_cents / 100,
        e.usd_cents === null ? "UNCONVERTED" : e.usd_cents / 100,
        e.starts_on,
        e.ends_on,
        e.recurrence,
      ]),
      [],
      ["Error groups", "Model", "Count", "Affected users", "Normalized sample"],
      ...d.errors.map((e) => [
        e.category,
        e.model,
        e.count,
        e.users,
        e.message,
      ]),
    ];
  const csv = rows
    .map((r) =>
      r
        .map(
          (v) =>
            `"${String(v ?? "")
              .replace(/"/g, '""')
              .replace(/^[\s]*[=+@\-]/, "'$&")}"`,
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `hansora-${state.range.start}-${state.range.end}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function initialize() {
  $("#export").disabled = true;
  if (localPreview) {
    $("#preview-notice").hidden = false;
    $("#preview-notice").textContent =
      "Local private preview · reporting snapshot · expense changes here are local and do not update production.";
    $("#signout").hidden = true;
    load();
    return;
  }
  for (let i = 0; i < 50 && !window.supabase?.createClient; i++)
    await new Promise((r) => setTimeout(r, 100));
  if (!window.supabase?.createClient) {
    message("The sign-in library could not load. Refresh to retry.");
    return;
  }
  const url = "https://qmaealblegvcwodlmeht.supabase.co";
  const key =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c";
  state.client = window.supabase.createClient(url, key);
  const { data } = await state.client.auth.getSession();
  if (data.session) await load();
  else {
    $("#page").innerHTML = "";
    $("#login-dialog").showModal();
  }
  state.client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      state.request++;
      state.data = null;
      $("#page").innerHTML = "";
      if (!$("#login-dialog").open) $("#login-dialog").showModal();
    }
  });
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = $("#login-submit");
  buttonBusy(button, true);
  $("#login-error").textContent = "";
  try {
    const { error } = await state.client.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-password").value,
    });
    if (error) throw Error("Sign-in failed. Check your email and password.");
    $("#login-password").value = "";
    $("#login-dialog").close();
    await load();
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    buttonBusy(button, false, "Sign in");
  }
};
$("#google-login").onclick = async () => {
  const { error } = await state.client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/business.html" },
  });
  if (error)
    $("#login-error").textContent =
      "Google sign-in could not start. Please retry.";
};
$("#signout").onclick = async () => {
  state.request++;
  state.data = null;
  $("#page").innerHTML = "";
  document.querySelectorAll("dialog").forEach((d) => d.close());
  await state.client?.auth.signOut({ scope: "local" });
};
initialize();
