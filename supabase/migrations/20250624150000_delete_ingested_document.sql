-- Remove all RAG chunks for a given PDF source (manager-only).

create or replace function public.delete_ingested_document(p_source text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
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

  if coalesce(trim(p_source), '') = '' then
    raise exception 'Source is required'
      using errcode = '22023';
  end if;

  delete from public.document_chunks
  where metadata ->> 'source' = p_source;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_ingested_document(text) to authenticated;
