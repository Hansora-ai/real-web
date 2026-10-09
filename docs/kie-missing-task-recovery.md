# KIE submissions without task IDs

Nano Banana, Nano Banana Pro, Nano Banana 2 and Nano Banana 2 Lite previously
accepted any HTTP 2xx create response and debited credits even if the response
contained no task ID. The checker returned `pending` forever, and history cards
only resumed provider checks when they had IDs.

The launchers now require a usable task ID and a successful KIE application code
when present. A rejected submission is recorded as failed without a debit. The
two image models using the shared image launcher also refund their reservation
when a completed create response contains no ID. Network timeouts retain a
temporary reservation for callback reconciliation.

Missing-ID history cards poll by user/run ID. The database recovery checks the
latest row, its KIE source, both task ID spellings, completion status and age.
The minimum grace period is five minutes; longer `ttl_secs` values are honored
up to thirty minutes. Tasks with IDs are never expired by this recovery.

The failure marker, profile credit increment and refund marker are committed in
one PostgreSQL transaction under a generation row lock. A database failure rolls
back all three changes so the next check can retry. Uncharged, unlimited and
already-refunded records receive no additional credits. A legacy refund claim
is flagged for manual reconciliation because it may already have paid.

## Rollout

1. Apply `supabase/14_kie_missing_task_recovery.sql` in the production Supabase SQL
   editor before deploying the updated functions. The RPCs are restricted to
   `service_role`; the checker and sweep use the existing service key.
2. Deploy the updated Netlify code. `kie-missing-task-sweep` runs every minute and
   recovers up to 100 abandoned KIE submissions, even if nobody opens the site.
3. To recover the reported record immediately after applying the SQL, run:

   ```sql
   select public.resolve_kie_missing_task('67ff00e2-4f3c-468e-b8bd-91d9dca1e0ca'::uuid);
   ```

   If its latest state still matches the supplied record, this marks it failed
   and returns its recorded 0.5 credits. Repeating the call cannot pay twice.

4. For an immediate backlog pass, run:

   ```sql
   select public.sweep_kie_missing_tasks(100);
   ```

   Inspect `errors` and database warnings for missing profiles. Rows that fail a
   refund transaction remain eligible for retry. Review rows with
   `refund_error = 'legacy_refund_claim_requires_review'` or
   `refund_skipped_reason = 'missing_refund_amount'` against billing records.

## Verification

`npm run test:kie` executes the migration in embedded PostgreSQL and checks the
reported charged/null-ID case, repeat calls, fresh submissions, existing tasks,
refund transaction rollback, offline backlog recovery and browser-role access.
It also runs the actual launchers and localized history polling functions with
mocked provider responses. The image model regression suite covers reservation
refunds for completed HTTP 200 responses without task IDs.

Embedded PostgreSQL serializes client calls; its repeat-call test does not
exercise two independent production connections. Production concurrency is
handled by `FOR UPDATE` and the transactional credit increment.
