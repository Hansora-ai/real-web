# Hansora owner business workspace

`/business.html` is a new, isolated owner dashboard. No public navigation, model prices, generation flow or locale pages change.

## Access and deployment

The frontend uses the existing Supabase project and Hansora login. Every report and expense/settings write goes through `business-dashboard`, which calls live `/auth/v1/user` and verifies the fixed owner UUID. Client user IDs and editable metadata never authorize requests. No service key is sent to the browser, no wildcard CORS is returned, and financial responses are `private, no-store`. Sign-out clears the rendered report.

The storage migration was created with the Supabase CLI and applied through the connected Supabase tool. It is idempotent for this project's SQL-script workflow. Both new tables have RLS and no `anon` or `authenticated` grants. Only the existing backend service role may execute the security-invoker snapshot RPC. Live grants and anonymous REST rejection were checked. No financial data rows were changed: the storage insert check ran inside a rolled-back transaction.

The application requires only the site's existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. After merging/deploying, open `/business.html` and sign in with the owner account. A production owner-browser sign-in has not been exercised during local development. The connector reads and server/database access checks were exercised.

## Screens

- Overview: reporting dates, sales subtotal, registrations, known provider costs, buyers/credit users, failures, cash after known costs, balances and expenses.
- Activity: models/configurations, statuses, normalized error groups, affected users and first/latest occurrence, and acquisition versus usage surface.
- Customers: current wallets, purchases through the report end, period usage, and purchased-package balance bounds.
- Expenses: add/edit/archive/restore one-off and recurring expenses, payment dates, coverage periods, notes, and currency conversion settings.

All reporting dates use Asia/Yerevan. Available presets are today, yesterday, seven days, current month, six calendar months and current year; custom ranges support up to 367 inclusive days.

## Accounting definitions and limits

The interface intentionally does **not** label an incomplete cash subtotal as final profit.

1. Payments are deduplicated by provider/transaction ID. Use settlement currency and subtract settlement tax. Checkout amounts in IDR, EUR, RON etc. are never summed as USD. Missing tax/currency conversions stay unconverted. Original payment counts still include those transactions. Manually entered FX values are planning conversions, not historical FX statements.
2. Dodo checkout fees are estimates from the standard rate model: 4% + $0.40, plus 1.5% non-US/unknown issuing country and 0.5% subscriptions. The base includes tax. Imported actual fee statements, FX costs and payout fees are not available. Payment refunds belong to the purchase cohort in the stored payload, not necessarily their cash refund date.
3. `charged_cost`, `model_cost`, `cost` etc. are customer internal credit units, **not provider USD**. Displayed credits are internal credits × 10. Refund metadata and the newer refund ledger are deduplicated.
4. Provider costs use explicit recorded USD when present, otherwise dated rate estimates for supported configurations. The checked rate inputs originate from the prior owner margin audit of 25 Oct 2026, the Wan rate check of 30 Oct, and provider model pages. Dates before 25 Oct remain unpriced rather than being retroactively assigned a new price. Wan's promotional rate ends 30 Nov. Rate overrides can be entered by exact model/resolution and effective dates. Unsupported configurations, incomplete metadata, ElevenLabs plan utilization/voice multipliers and failed-task charges remain unpriced. A customer refund does not prove a provider refund. Some provider post-generation failures retain charges: https://reapi.ai/docs/api/tasks .
5. The free-usage indicator is deliberately called **nonbuyer usage**: jobs before the first recorded purchase, excluding explicitly unlimited jobs. It may not capture gifted/free credit use after purchase or external payment channels. Website sales-assistant attribution is not treated as ChatGPT acquisition. Unknown acquisition stays unknown.
6. Owner and confirmed employee usage is excluded from customer metrics but its known API cost remains in the business cash calculation.
7. Buyer wallet balances are current snapshots even when looking at an older report. Purchased-package balances replay credit movements and match purchase grants within ten minutes. Unknown debit provenance produces conservative lower/upper bounds, never an invented FIFO fact. Package bonuses are included. Ledger gaps or unmatched grants widen the range. The future-cost scenario uses the selected period's known successful-job cost per charged credit; future model mix can differ. It is not simply subtracted in full from today's revenue.
8. Similar failure groups normalize changing IDs, URLs and numeric amounts within provider/model/category. HTTP status codes stay distinct. These are similarity groups, not proven root causes. Historical retry links are missing, so recovery counts are not fabricated. Failed rows with a result are explicitly identifiable.
9. Expense allocations conserve invoice cents across covered days. One-off cash occurs on the payment date; recurring renewals are labelled projections. Editing a recurring schedule revises it; stop the old schedule and create a new one for a prospective price change. Archived expenses remain recoverable.
10. Final earned profit still requires settled provider costs, complete currency/fee/refund reconciliation and a paid/free credit ledger. The current version offers known-cost cash flow and an outstanding-credit scenario, with visible data-quality checks. It does not claim those are exact profit.

Sources: https://dodopayments.com/pricing , https://kie.ai/grok-imagine , https://kie.ai/veo-3-1 , https://kie.ai/kling-4-0 , https://reapi.ai/models/seedance-2-5 , https://reapi.ai/models/wan-3-0 .

## Validation

`node --test test/business/*.test.mjs` — 29 checks covering owner authorization, scoped writes, money/FX handling, grant bounds, refund deduplication, error grouping, date ranges and cent-conserving expense allocations.

`node scripts/build-netlify-functions.mjs` — generates the new endpoint with existing deployment wrappers.

`node --test test/netlify/*.test.mjs` — 16 existing build/runtime checks pass, including actual endpoint bundling.

Database RLS/grants were verified live, anonymous REST calls returned 401, and the security advisor returned no findings for the new business objects.

## Local review

`scripts/business-dev.mjs` serves a loopback-only reporting snapshot on `127.0.0.1:4183`. It requires an owner-read snapshot outside public assets at `/tmp/hansora-business-preview/snapshot.json`. This file is not in the repository. Local expense edits go to a separate temporary file and never production. Browser screenshots and real financial records must not be committed to this public repository.

The local migration-history check could not connect because this checkout has no running local Postgres on port 54322. Schema and permissions were verified against the connected project instead. The browser viewport override did not take effect (the preview stayed at 1280px), so a new 390px mobile run is not claimed; responsive styles are included.

### Before purchase and generation feedback

Activity → Before purchase selects customers whose first recorded successful payment falls in the reporting period (Asia/Yerevan). It reads all retained generation history before that payment, including dates before the reporting window, deduplicating run IDs. Each buyer is grouped once by the last successful model, no retained generation, failed attempts only, or other unresolved attempts. The second model table overlaps when a buyer tried multiple models. Internal owner/employee accounts are excluded. Payment channels missing from the connected payments table and deleted generations remain coverage limits. Status is the current saved generation status; historical completion times are not available, so a job submitted before purchase may have finished later. This is descriptive buyer behavior, not causal attribution or a conversion-rate denominator.

Activity → Ratings & comments reads `generation_ratings`, with per-model likes/dislikes, like rate, reasons and searchable comments. It preserves ratings whose source generation has been deleted. The selected date refers to the latest saved vote update, not an immutable historical vote log. There is one current vote per run; internal accounts are excluded. Comments are HTML-escaped and CSV exports protect formula-leading values. Financial calculations are unchanged by these additions.
