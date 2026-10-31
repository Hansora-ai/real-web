// Local-only owner preview. No credentials are read or copied into the browser.
// Snapshot path is outside public/; mutations affect an isolated local copy only.
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { buildProfit } from "../lib/business/profit.mjs";
import { validateExpense, dayNumber } from "../public/business/finance.mjs";
const root = resolve("public"),
  store = "/tmp/hansora-business-preview/snapshot.json";
const snapshot = JSON.parse(await readFile(store, "utf8"));
try {
  snapshot.expenses = JSON.parse(
    await readFile("/tmp/hansora-business-preview/local-expenses.json", "utf8"),
  );
} catch {}
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const localDay = (v) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(v));
const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  try {
    if (!/^127\.0\.0\.1:4183$/.test(req.headers.host || ""))
      return send(res, 403, { error: "Local preview host only." });
    if (req.headers.origin && req.headers.origin !== "http://127.0.0.1:4183")
      return send(res, 403, { error: "Local preview origin only." });
    const url = new URL(req.url, "http://127.0.0.1:4183");
    if (url.pathname === "/.netlify/functions/business-dashboard") {
      if (req.method === "GET") {
        const start = url.searchParams.get("start"),
          end = url.searchParams.get("end");
        if (
          dayNumber(end) < dayNumber(start) ||
          dayNumber(end) - dayNumber(start) > 366
        )
          return send(res, 400, { error: "Choose up to 367 days." });
        const selected = structuredClone(snapshot);
        selected.generations = selected.generations.filter((g) => {
          const day = localDay(g.created_at);
          return day >= start && day <= end;
        });
        selected.payments = selected.payments.filter(
          (p) => localDay(p.paid_at || p.created_at) <= end,
        );
        selected.registrations = selected.registrations.filter(
          (r) => r.day >= start && r.day <= end,
        );
        selected.metadata_refunds = (selected.metadata_refunds || []).filter(
          (r) => {
            const day = localDay(r.created_at);
            return day >= start && day <= end;
          },
        );
        selected.refunds = selected.refunds.filter((r) => {
          const day = localDay(r.created_at);
          return day >= start && day <= end;
        });
        selected.buyers = selected.buyers
          .filter((b) => selected.payments.some((p) => p.uid === b.user_id))
          .map((b) => {
            const payments = selected.payments.filter(
              (p) => p.uid === b.user_id,
            );
            return {
              ...b,
              payments: payments.length,
              package_credits: payments.reduce(
                (s, p) => s + Number(p.credits || 0),
                0,
              ),
            };
          });
        return send(res, 200, buildProfit(selected, { start, end }));
      }
      if (req.method !== "POST")
        return send(res, 405, { error: "Method not allowed." });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 50000)
          return send(res, 413, { error: "Too much data." });
      }
      const body = JSON.parse(raw);
      if (body.action === "save_expense") {
        const expense = {
          ...validateExpense(body.expense),
          id: body.id || crypto.randomUUID(),
        };
        snapshot.expenses = (snapshot.expenses || []).filter(
          (e) => e.id !== expense.id,
        );
        snapshot.expenses.push(expense);
      } else if (["archive_expense", "restore_expense"].includes(body.action)) {
        const expense = snapshot.expenses.find((e) => e.id === body.id);
        if (!expense) return send(res, 404, { error: "Expense not found." });
        expense.archived_at =
          body.action === "archive_expense" ? new Date().toISOString() : null;
      } else if (body.action === "save_settings") {
        snapshot.settings = body.settings;
      } else return send(res, 400, { error: "Unknown action." });
      await writeFile(
        "/tmp/hansora-business-preview/local-expenses.json",
        JSON.stringify(snapshot.expenses),
        { mode: 0o600 },
      );
      return send(res, 200, { ok: true });
    }
    if (req.method !== "GET")
      return send(res, 405, { error: "Method not allowed." });
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          url.pathname === "/" ? "/business.html" : url.pathname,
        ),
    );
    if (!path.startsWith(root + "/"))
      return send(res, 403, { error: "Forbidden." });
    const content = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    res.end(content);
  } catch (error) {
    send(res, 400, {
      error: error.code === "ENOENT" ? "Not found." : error.message,
    });
  }
});
server.listen(4183, "127.0.0.1", () =>
  console.log(
    "Hansora private local preview: http://127.0.0.1:4183/business.html",
  ),
);
