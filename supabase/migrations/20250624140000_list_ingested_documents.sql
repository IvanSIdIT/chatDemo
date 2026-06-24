-- List distinct PDF sources that have been ingested into document_chunks.
-- Callable by managers via authenticated client (role check inside function).

create or replace function public.list_ingested_documents()
returns table (
  source text,
  document_title text,
  chunk_count bigint,
  first_ingested_at timestamptz,
  last_ingested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.accounts
    where id = auth.uid()
      and role = 'manager'
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    dc.metadata ->> 'source' as source,
    max(dc.metadata ->> 'document_title') as document_title,
    count(*)::bigint as chunk_count,
    min(dc.created_at) as first_ingested_at,
    max(dc.created_at) as last_ingested_at
  from public.document_chunks dc
  where coalesce(dc.metadata ->> 'source', '') <> ''
  group by dc.metadata ->> 'source'
  order by max(dc.created_at) desc;
end;
$$;

grant execute on function public.list_ingested_documents() to authenticated;
