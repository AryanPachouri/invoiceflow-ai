-- Optional: create the private document bucket manually in the Supabase SQL editor.
-- (The app also creates it automatically on first upload using the service-role key.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
