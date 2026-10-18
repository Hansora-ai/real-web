# Website feedback

The desktop header has a compact speech-bubble button with a localized Feedback tooltip. On phones, Feedback is in the bottom navigation's Menu sheet. Both load the same small form in `public/feedback.js`; it contains only the message and Send. English, Russian and Armenian copy follows the current page language. Native modal focus management, Escape, explicit close and responsive sizing are supported.

Submissions require the existing Hansora login. A failed request leaves the message in the form; success appears only after Supabase confirms the saved UUID. Retrying an uncertain request reuses its UUID to avoid duplicates. The UI preserves draft text while opening the existing login modal. Navigation through OAuth follows the existing login flow; drafts are kept only in memory, not across full-page redirects.

## Supabase setup and review

Apply `supabase/18_user_feedback.sql` once in the Supabase SQL Editor before publishing the UI. It is idempotent. This migration was applied to the Hansora project `qmaealblegvcwodlmeht` on October 18, 2026, and its live RLS/function permissions were verified. Merging the website PR does not require another database step.

Open **Table Editor → public → user_feedback** to review submissions. Columns are:

- `user_id`, `email`: captured by the database from the authenticated account; the form cannot supply another user's identity. Email is nullable for accounts without an email.
- `message`: trimmed feedback, 1–5000 characters.
- `created_at`: submission time.
- `page_path`, `language`: page pathname (without query/fragment) and UI language for context.
- `id`: UUID used for safe retries.

The table has RLS enabled and no browser read/write grants or policies. The only client access is the authenticated `submit_user_feedback` RPC. It derives identity from `auth.uid()` and `auth.users`, uses a fixed empty search path, and limits submissions to 10 per account per hour under a transaction lock. Only administrators/service-role access can review the table. No new Netlify variables or service-role key in the browser are needed.

## Validation

Run `npm run test:feedback`. Embedded PostgreSQL executes the migration twice and verifies identity, nullable/current email, Unicode text, private table permissions, anonymous rejection, validation, duplicate retries and per-account rate limiting. Navigation tests execute the edge injector, check localized entries and standalone-page exclusions, and parse the generated navigation JavaScript. Browser checks cover the actual header/phone Menu and signed-out behavior; controlled local transport checks cover successful sends and failures that preserve the draft.
