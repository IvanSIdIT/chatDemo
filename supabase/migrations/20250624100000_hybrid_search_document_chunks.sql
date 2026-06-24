-- Hybrid RAG: full-text (BM25-style) search alongside pgvector semantic search.
-- Run in Supabase SQL Editor after document_chunks exists.

alter table public.document_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('simple', content)) stored;

create index if not exists document_chunks_content_tsv_idx
  on public.document_chunks
  using gin (content_tsv);

create or replace function public.match_chunks_keyword(
  search_query text,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  rank float
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select nullif(trim(search_query), '') as q
  )
  select
    dc.id,
    dc.content,
    dc.metadata,
    ts_rank_cd(dc.content_tsv, query.tsq)::float as rank
  from public.document_chunks dc
  cross join normalized
  cross join lateral (
    select coalesce(
      websearch_to_tsquery('simple', normalized.q),
      ''::tsquery
    ) as tsq
  ) query
  where normalized.q is not null
    and query.tsq <> ''::tsquery
    and dc.content_tsv @@ query.tsq
  order by rank desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_chunks_keyword(text, int) to authenticated;
grant execute on function public.match_chunks_keyword(text, int) to service_role;
