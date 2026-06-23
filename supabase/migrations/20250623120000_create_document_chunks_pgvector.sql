-- RAG knowledge base: semantic document chunks with pgvector
-- Enable in Supabase Dashboard → Database → Extensions → vector (if not already on)

create extension if not exists vector;

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(trim(content)) > 0),
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index document_chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

create index document_chunks_metadata_source_idx
  on public.document_chunks ((metadata ->> 'source'));

create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.75,
  match_count int default 3
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_chunks(vector, float, int) to authenticated;

alter table public.document_chunks enable row level security;

create policy "Authenticated users can read document chunks"
  on public.document_chunks
  for select
  to authenticated
  using (true);

-- Inserts are performed by ingest.py using the service role key (bypasses RLS).
