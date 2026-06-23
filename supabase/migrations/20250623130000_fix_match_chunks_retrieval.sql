-- Fix vector retrieval: include extensions schema, return top-K by cosine distance.
-- Run in Supabase SQL Editor if match_chunks already exists from earlier migration.

create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.0,
  match_count int default 5
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
set search_path = public, extensions
as $$
  select
    dc.id,
    dc.content,
    dc.metadata,
    (1 - (dc.embedding <=> query_embedding))::float as similarity
  from public.document_chunks dc
  where query_embedding is not null
    and (
      match_threshold <= 0
      or (1 - (dc.embedding <=> query_embedding)) > match_threshold
    )
  order by dc.embedding <=> query_embedding asc
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_chunks(vector, float, int) to authenticated;
grant execute on function public.match_chunks(vector, float, int) to service_role;
