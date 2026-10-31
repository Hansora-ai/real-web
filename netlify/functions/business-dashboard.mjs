import {
  requireOwner,
  database,
  json,
  OWNER_ID,
} from "../../lib/business/access.mjs";
import { buildDashboard } from "../../lib/business/analytics.mjs";
import { validateExpense, dayNumber } from "../../public/business/finance.mjs";
const uuid = (value) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value || "",
  );
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
      const snapshot = await database(auth, "rpc/business_dashboard_snapshot", {
        method: "POST",
        body: JSON.stringify({ p_start: start, p_end: end }),
      });
      return json(200, buildDashboard(snapshot, { start, end }));
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
        rates = [];
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
      if (!Array.isArray(settings.rates) || settings.rates.length > 150)
        return json(400, { error: "Use up to 150 provider rate rules." });
      for (const r of settings.rates) {
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
          settings: { fx, rates },
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
