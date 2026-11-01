// Owner profit page. All numbers come from /.netlify/functions/business-dashboard (owner-only).
import { dayNumber, dateString, todayUTC } from "./finance.mjs";

const $ = (s) => document.querySelector(s);
const localPreview = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
const state = { client: null, range: null, data: null, request: 0 };

const usd = (v, sign = false) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `−${s}` : sign && v > 0 ? `+${s}` : s;
};
const int = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const when = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const tone = (v) => (v > 0.005 ? "up" : v < -0.005 ? "down" : "");

function rangeFor(preset) {
  const today = todayUTC(), t = dayNumber(today);
  const month = today.slice(0, 7);
  switch (preset) {
    case "today": return { start: today, end: today };
    case "yesterday": return { start: dateString(t - 1), end: dateString(t - 1) };
    case "2d": return { start: dateString(t - 1), end: today };
    case "7d": return { start: dateString(t - 6), end: today };
    case "month": return { start: `${month}-01`, end: today };
    case "lastmonth": {
      const first = new Date(`${month}-01T00:00:00Z`);
      const last = new Date(first - 86400000);
      return { start: `${last.toISOString().slice(0, 7)}-01`, end: last.toISOString().slice(0, 10) };
    }
    default: return { start: dateString(t - 29), end: today };
  }
}

async function api(options = {}) {
  let token = "";
  if (!localPreview) token = (await state.client.auth.getSession()).data.session?.access_token || "";
  const query = options.method ? "" : `?${new URLSearchParams(state.range)}`;
  const res = await fetch(`/.netlify/functions/business-dashboard${query}`, {
    cache: "no-store", ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({ error: "The server sent an unexpected answer." }));
  if (res.status === 401 && !localPreview) { $("#page").hidden = true; $("#login").showModal(); }
  if (!res.ok) throw Error(body.error || "Something went wrong. Please retry.");
  return body;
}

async function load() {
  const id = ++state.request;
  $("#status").textContent = "Loading…";
  try {
    const data = await api();
    if (id !== state.request) return;
    state.data = data;
    render(data);
    $("#status").textContent = "";
    $("#page").hidden = false;
  } catch (e) {
    if (id === state.request) $("#status").textContent = e.message;
  }
}

function tile(el, label, value, cls, lines) {
  el.innerHTML = `<span class="label">${label}</span><strong class="${cls || ""}">${value}</strong>${lines.map((l) => `<span class="line">${l}</span>`).join("")}`;
}

function render(d) {
  const t = d.totals;
  const days = d.days.length;
  $("#period").textContent = `${days === 1 ? shortDay(d.range.start) : `${shortDay(d.range.start)} – ${shortDay(d.range.end)} · ${days} days`} · Armenia time`;
  const warn = $("#warning");
  warn.hidden = !d.quality.unconverted_payments.length;
  warn.innerHTML = d.quality.needs_rub_rate
    ? `${d.quality.unconverted_payments.length} YooMoney payment(s) are not counted yet. Set the RUB → USD rate in Settings at the bottom.`
    : `${d.quality.unconverted_payments.length} payment(s) could not be converted to USD and are not counted.`;
  tile($("#tile-profit"), "Net profit", usd(t.profit), tone(t.profit), [
    t.margin != null ? `${t.margin}% of money in` : "No sales in this period",
    days > 1 ? `${usd(t.profit / days)} a day on average` : "",
  ].filter(Boolean));
  tile($("#tile-in"), "Money in", usd(t.net), "", [
    `${int(t.payments)} payment${t.payments === 1 ? "" : "s"} · ${usd(t.gross)} paid`,
    `− tax ${usd(t.tax)} − fees ${usd(t.fees)}${t.refunds ? ` − refunds ${usd(t.refunds)}` : ""}`,
  ]);
  tile($("#tile-cost"), "Costs", usd(t.cost_of_sold - t.correction + t.cost_free + t.cost_internal), "", [
    `Credits sold ${usd(t.cost_of_sold)} <small>(${int(t.credits_sold)} × $${t.cost_per_credit.toFixed(4)})</small>`,
    `Free users ${usd(t.cost_free)} · Your own use ${usd(t.cost_internal)}`,
    `Real-use correction <b class="${tone(t.correction)}">${usd(t.correction, true)}</b>`,
  ]);
  tile($("#tile-exp"), "Expenses", usd(t.expenses), "", [`${d.expenses.length} active · spread per day`]);

  chart(d.days);
  const row = (r) => [usd(r.net), usd(r.cost_of_sold), `<span class="${tone(r.correction)}">${usd(r.correction, true)}</span>`, usd(r.cost_free), usd(r.cost_internal), usd(r.expenses), `<b class="${tone(r.profit)}">${usd(r.profit)}</b>`, `<span class="muted">${usd(r.cost)}</span>`, int(r.signups), `${int(r.new_buyers)} new${r.repeat_buyers ? ` · ${r.repeat_buyers} again` : ""}`];
  table($("#days"), ["Day", "Money in", "Credits sold cost", "Real-use correction", "Free users", "Own use", "Expenses", "Profit", "Provider spending", "Sign-ups", "Buyers"],
    [...d.days].reverse().map((r) => [shortDay(r.day), ...row(r)]), ["Total", ...row(t)]);

  const reserve = t.reserve_for_unused_now;
  kv($("#credits"), [
    ["Credits sold", `${int(t.credits_sold)}`],
    ["Used by buyers", `${int(t.credits_used_buyers)}`],
    ["Used by free users", `${int(t.credits_used_free)}`],
    ["Not used yet by buyers (now)", `${int(t.unused_credits_now)} credits · ${usd(t.unused_value_now)} paid for them`],
    ["Cost to serve them", `about ${usd(reserve)} <small>(at $${t.cost_per_credit.toFixed(4)} a credit)</small>`],
    ["Free users ate", t.net > 0 ? `${usd(t.cost_free)} · ${Math.round((t.cost_free / t.net) * 100)}% of money in` : usd(t.cost_free)],
  ]);
  kv($("#people"), [
    ["Signed up", int(t.signups)],
    ["Generated something", int(t.generators)],
    ["Generations", `${int(t.generations)}${t.failed ? ` · ${int(t.failed)} failed` : ""}`],
    ["New buyers", int(t.new_buyers)],
    ["Bought again", int(t.repeat_buyers)],
    ["Sign-up → buyer", t.signups ? `${Math.round((t.new_buyers / t.signups) * 1000) / 10}%` : "—"],
  ]);

  const max = Math.max(1, ...d.last_models.map((m) => m.count));
  $("#lastmodels").innerHTML = d.last_models.length
    ? d.last_models.map((m) => `<div class="bar"><span>${esc(m.model)}</span><i style="width:${(m.count / max) * 100}%"></i><b>${m.count}</b></div>`).join("")
    : `<p class="empty">No new buyers in this period.</p>`;
  table($("#models"), ["Model", "Runs", "Failed", "Free runs", "Credits", "Cost"],
    d.models.map((m) => [esc(m.model), int(m.runs), int(m.failed), int(m.free_runs), int(m.credits), usd(m.cost)]));
  table($("#journeys"), ["Bought", "Buyer", "Last before buying", "Tries", "Failed", "Time to buy"],
    d.journeys.map((j) => [when(j.first_purchase), esc(j.email || j.user_id.slice(0, 8)), esc(j.last_model), int(j.generations), int(j.failed), j.hours_to_buy == null ? "—" : j.hours_to_buy < 1 ? `${Math.round(j.hours_to_buy * 60)} min` : j.hours_to_buy < 48 ? `${Math.round(j.hours_to_buy)} h` : `${Math.round(j.hours_to_buy / 24)} days`]));
  table($("#sales"), ["When", "Buyer", "Via", "Credits", "Paid", "Tax", "Fee", "Money in"],
    d.sales.map((s) => [when(s.paid_at), esc(s.email || s.user_id?.slice(0, 8)), s.provider, int(s.credits), usd(s.gross), usd(s.tax), usd(s.fees), `<b>${usd(s.net)}</b>`]));
  table($("#buyers"), ["Buyer", "Paid (net)", "Credits bought", "Used", "Real cost of use", "Profit so far", "Unused", "Expected on unused", "Total profit", "Margin"],
    [...d.buyers].sort((a, b) => b.paid - a.paid).slice(0, 40).map((b) => [esc(b.email || b.user_id.slice(0, 8)), usd(b.paid), int(b.bought), int(b.used_credits), usd(b.used_cost),
      `<span class="${tone(b.earned)}">${usd(b.earned)}</span>`, int(b.unused), usd(b.expected), `<b class="${tone(b.profit)}">${usd(b.profit)}</b>`, b.margin == null ? "—" : `${b.margin}%`]));
  table($("#expenses"), ["Name", "Amount", "Repeats", "Since", ""],
    d.expenses.map((e) => [esc(e.name), `${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${esc(e.currency)}`, { none: "Once", monthly: "Monthly", yearly: "Yearly" }[e.recurrence] || e.recurrence, shortDay(e.starts_on), `<button class="link" data-archive="${esc(e.id)}">Remove</button>`]));

  $("#s-rub").value = d.settings.fx?.RUB ?? "";
  $("#s-ymfee").value = d.settings.fees?.yoomoney_pct ?? "";
  const q = d.quality, notes = [];
  if (q.estimated_runs) notes.push(`${int(q.estimated_runs)} of ${int(q.runs)} generations didn't save their settings, so their cost is the credits charged × that model's cost per credit from the price sheet.`);
  if (q.unknown_cost_runs) notes.push(`${int(q.unknown_cost_runs)} generations have no price (unknown model, no credits charged).`);
  $("#quality-note").innerHTML = notes.join(" ") || "All generations were priced from their recorded settings.";
}

function kv(el, rows) { el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(""); }
function table(el, head, rows, foot) {
  el.innerHTML = rows.length
    ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>${foot ? `<tfoot><tr>${foot.map((c) => `<td>${c}</td>`).join("")}</tr></tfoot>` : ""}`
    : `<tbody><tr><td class="empty">Nothing in this period.</td></tr></tbody>`;
}

// Bars for money in and costs (provider + expenses) per day, with a profit line.
function chart(days) {
  const w = 720, h = 220, pad = 30, n = days.length;
  const vals = days.flatMap((d) => [d.net, d.cost_of_sold + d.cost_free + d.cost_internal + d.expenses, d.profit]);
  const top = Math.max(1, ...vals), bottom = Math.min(0, ...vals);
  const y = (v) => pad + ((top - v) / (top - bottom)) * (h - pad * 2);
  const slot = (w - pad * 2) / n, bw = Math.max(2, Math.min(22, slot * 0.36));
  const x = (i) => pad + slot * i + slot / 2;
  const costs = (d) => d.cost_of_sold + d.cost_free + d.cost_internal + d.expenses;
  const bars = days.map((d, i) => `<rect class="b-in" x="${x(i) - bw - 1}" y="${y(Math.max(0, d.net))}" width="${bw}" height="${Math.abs(y(0) - y(d.net))}"><title>${shortDay(d.day)} · in ${usd(d.net)}</title></rect><rect class="b-cost" x="${x(i) + 1}" y="${y(costs(d))}" width="${bw}" height="${Math.abs(y(0) - y(costs(d)))}"><title>${shortDay(d.day)} · costs ${usd(costs(d))}</title></rect>`).join("");
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.profit).toFixed(1)}`).join(" ");
  const dots = days.map((d, i) => `<circle class="${d.profit < 0 ? "dot-down" : "dot"}" cx="${x(i)}" cy="${y(d.profit)}" r="${n > 40 ? 1.5 : 3}"><title>${shortDay(d.day)} · profit ${usd(d.profit)}</title></circle>`).join("");
  const every = Math.ceil(n / 8);
  const labels = days.map((d, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${h - 8}">${shortDay(d.day)}</text>` : "")).join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Money in, costs and profit per day"><line class="zero" x1="${pad}" x2="${w - pad}" y1="${y(0)}" y2="${y(0)}"/>${bars}<path class="p-line" d="${line}"/>${dots}${labels}<text class="axis" x="${pad}" y="14">${usd(top)}</text></svg>`;
}

function setRange(range, preset) {
  state.range = range;
  $("#from").value = range.start; $("#to").value = range.end;
  document.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("on", b.dataset.range === preset));
  try { localStorage.setItem("hansora-profit-range", preset || ""); } catch {}
  load();
}
document.querySelectorAll("[data-range]").forEach((b) => (b.onclick = () => setRange(rangeFor(b.dataset.range), b.dataset.range)));
$("#apply").onclick = () => {
  const start = $("#from").value, end = $("#to").value;
  if (!start || !end || end < start) { $("#status").textContent = "Choose a start and an end date."; return; }
  setRange({ start, end }, null);
};
$("#refresh").onclick = () => load();

$("#expense-form").onsubmit = async (e) => {
  e.preventDefault();
  const start = $("#e-start").value, recurrence = $("#e-recurrence").value;
  const next = new Date(`${start}T00:00:00Z`);
  if (recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else if (recurrence === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCDate(next.getUTCDate() + 1);
  const ends_on = new Date(next - 86400000).toISOString().slice(0, 10);
  $("#e-msg").textContent = "Saving…";
  try {
    await api({ method: "POST", body: JSON.stringify({ action: "save_expense", expense: { name: $("#e-name").value, amount: $("#e-amount").value.replace(",", "."), currency: $("#e-currency").value, recurrence, paid_on: start, starts_on: start, ends_on, category: "other" } }) });
    e.target.reset(); $("#e-start").value = todayUTC();
    $("#e-msg").textContent = "Added.";
    load();
  } catch (err) { $("#e-msg").textContent = err.message; }
};
$("#expenses").onclick = async (e) => {
  const id = e.target.dataset?.archive;
  if (!id || !confirm("Remove this expense? It stops counting from now on in every period.")) return;
  try { await api({ method: "POST", body: JSON.stringify({ action: "archive_expense", id }) }); load(); } catch (err) { $("#status").textContent = err.message; }
};
$("#settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const fx = { ...(state.data?.settings.fx || {}) };
  const rub = $("#s-rub").value.trim().replace(",", ".");
  if (rub) fx.RUB = Number(rub); else delete fx.RUB;
  $("#s-msg").textContent = "Saving…";
  try {
    await api({ method: "POST", body: JSON.stringify({ action: "save_settings", settings: { fx, fees: { yoomoney_pct: Number($("#s-ymfee").value.trim().replace(",", ".") || 0) } } }) });
    $("#s-msg").textContent = "Saved."; load();
  } catch (err) { $("#s-msg").textContent = err.message; }
};

async function start() {
  $("#e-start").value = todayUTC();
  let preset = "today";
  try { preset = localStorage.getItem("hansora-profit-range") || "today"; } catch {}
  const begin = () => setRange(rangeFor(preset), preset);
  if (localPreview) { $("#signout").hidden = true; begin(); return; }
  for (let i = 0; i < 50 && !window.supabase?.createClient; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.supabase?.createClient) { $("#status").textContent = "Sign-in could not load. Refresh the page."; return; }
  state.client = window.supabase.createClient("https://qmaealblegvcwodlmeht.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtYWVhbGJsZWd2Y3dvZGxtZWh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2MjkzNzMsImV4cCI6MjA3NDIwNTM3M30.bUV6W0zBtkd_6gtfPGBSpskybUmpLC-1znljoDpYy4c");
  const { data } = await state.client.auth.getSession();
  if (data.session) begin(); else $("#login").showModal();
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    $("#login-msg").textContent = "Signing in…";
    const { error } = await state.client.auth.signInWithPassword({ email: $("#login-email").value.trim(), password: $("#login-password").value });
    if (error) { $("#login-msg").textContent = "Sign-in failed. Check your email and password."; return; }
    $("#login-password").value = ""; $("#login").close(); begin();
  };
  $("#google").onclick = () => state.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/business.html` } });
  $("#signout").onclick = async () => { await state.client.auth.signOut({ scope: "local" }); state.data = null; $("#page").hidden = true; $("#login").showModal(); };
}
start();
