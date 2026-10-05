-- Hansora Automation: where each chat stands (new / interested / ready / done / lost), for the inbox stage tabs.
-- Safe to run more than once.
begin;
alter table automation.automation_conversations add column if not exists sales_stage text not null default 'new';
alter table automation.automation_conversations add column if not exists sales_interest text not null default '';
alter table automation.automation_conversations add column if not exists sales_value numeric(14,2);
alter table automation.automation_conversations add column if not exists sales_currency text;
alter table automation.automation_conversations add column if not exists sales_updated_at timestamptz;
alter table automation.automation_conversations drop constraint if exists automation_conversations_sales_stage_check;
alter table automation.automation_conversations add constraint automation_conversations_sales_stage_check
  check (sales_stage in ('new', 'interested', 'ready', 'done', 'lost'));
alter table automation.automation_conversations drop constraint if exists automation_conversations_sales_interest_check;
alter table automation.automation_conversations add constraint automation_conversations_sales_interest_check
  check (char_length(sales_interest) <= 200);
alter table automation.automation_conversations drop constraint if exists automation_conversations_sales_currency_check;
alter table automation.automation_conversations add constraint automation_conversations_sales_currency_check
  check (sales_currency is null or sales_currency ~ '^[A-Z]{3}$');
create index if not exists automation_conversations_business_stage_idx
  on automation.automation_conversations (business_id, sales_stage, last_message_at desc);
-- Chats that already have an order or booking start as "done".
update automation.automation_conversations c set sales_stage = 'done'
where sales_stage = 'new' and exists (
  select 1 from automation.automation_outcomes o
  where o.conversation_id = c.id and o.outcome_type in ('order', 'booking') and o.status <> 'cancelled');
commit;
notify pgrst, 'reload schema';
