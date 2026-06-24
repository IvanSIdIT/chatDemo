-- Storage bucket for worker PDF attachments sent to managers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-attachments',
  'employee-attachments',
  false,
  20971520,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
