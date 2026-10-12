# Website assistant: 14-day content retention

`chat_messages` previously had no age filter or cleanup. The existing
`chat_sessions.expires_at` is extended to 90 days by `touch_chat_session` on
each insert and is not enforced by the application. It remains session metadata;
it is not the content retention policy.

This change covers both user and assistant messages, including `response_json`,
human corrections and other columns in the deleted message row. GET history,
request replay lookup and provider context only load messages from the last
14 days. Database Cron removes older rows hourly in batches of up to 5,000.
Physical removal can lag the cutoff by up to one hour under normal operation;
a backlog or failed job requires monitoring. Expired content is immediately
excluded from application history even before the next cleanup run.

Summaries and saved sales preferences use a separate `memory_expires_at`.
The deadline is capped by the oldest message used in the provider context and
any unexpired prior memory deadline. New activity does not extend old memory.
Expired or legacy memory without a deadline is ignored by the application.
The cleanup clears expired summaries, preferences and summary sequence markers.
Legacy deadlines use session creation plus 14 days as a conservative lower
bound because individual preference source timestamps were not recorded.

Session identities, usage counters, events, purchases, attribution and credit
records are preserved. Production message references in usage, events and
purchase attribution use `ON DELETE SET NULL`; the records survive cleanup.
No other conversations (`automation_messages`, Telegram or Instagram) are
included. Browser storage holds a session ID, not a transcript. Open pages
can still display already rendered messages until reloaded.

This is a live application database policy. Supabase backup recovery windows
and AI-provider retention are separate and are not changed by this migration.

## Release

1. Merge/deploy the application change. Before SQL is applied, age filtering
   works and untimestamped memory is ignored; memory writes safely fall back
   to history if the new column is not yet available.
2. Preview the scope in the production SQL Editor (read-only):

   ```sql
   select count(*) as expired_messages,
          min(created_at) as oldest_message
   from public.chat_messages
   where created_at < now() - interval '14 days';

   select count(*) as legacy_memories_due_to_expire
   from public.chat_sessions
   where created_at + interval '14 days' <= now()
     and (summary <> '' or sales_memory <> '{}'::jsonb);
   ```

3. Apply `supabase/17_website_chat_retention.sql` as the database owner after
   approving permanent removal of expired content. It enables hourly cleanup;
   it does not run the purge immediately. No credentials or environment changes
   are required. Applying it twice updates the same named job.
4. Verify activation and successful runs:

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'website-chat-content-retention-14d';

   select status, return_message, start_time, end_time
   from cron.job_run_details
   where jobid in (
     select jobid from cron.job
     where jobname = 'website-chat-content-retention-14d'
   )
   order by start_time desc limit 10;
   ```

To stop future purges without touching other jobs:

```sql
select cron.unschedule('website-chat-content-retention-14d');
```

Stopping cleanup cannot restore already purged content. Keep application age
filtering enabled. Monitor failed runs and the expired row count, especially
if more than 5,000 messages expire in an hour.

Official scheduling reference: [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart).
