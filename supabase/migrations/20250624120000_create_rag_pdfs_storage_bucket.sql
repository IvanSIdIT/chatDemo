-- Storage bucket for manager-uploaded RAG PDFs.
-- Service role uploads from the API; optional worker downloads for ingest.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rag-pdfs',
  'rag-pdfs',
  false,
  83886080,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
