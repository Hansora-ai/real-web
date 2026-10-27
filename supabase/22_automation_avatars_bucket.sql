-- Hansora Automation: customers' profile photos (Instagram, Messenger, TikTok). The platforms' own photo links expire
-- after a few days, so Hansora keeps a small copy here. Public like the photos themselves; file names are hashed.
-- Safe to run more than once.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('automation-avatars', 'automation-avatars', true, 2097152, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
