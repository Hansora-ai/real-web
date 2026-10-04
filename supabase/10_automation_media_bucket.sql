-- Hansora Automation: private storage for photos, videos and voice notes customers send in chats.
-- Shown to the business owner in the Inbox through short-lived links. Safe to run more than once.
insert into storage.buckets (id, name, public, file_size_limit)
values ('automation-media', 'automation-media', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
