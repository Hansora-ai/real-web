-- How the owner started: 'full' (an AI employee with business knowledge that
-- answers messages, calls and comments) or 'comments' (only comment
-- automations for Instagram and TikTok; the AI employee is set up later).
-- In 'comments' mode the AI does not answer messages on its own: the channel
-- connections start with automatic replies off.
begin;

alter table automation.automation_businesses
  add column if not exists setup_mode text not null default 'full' check (setup_mode in ('full', 'comments'));

commit;
