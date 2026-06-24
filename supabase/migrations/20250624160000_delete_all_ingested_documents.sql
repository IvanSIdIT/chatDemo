-- Remove all ingested RAG chunks (manager-only).

create or replace function public.delete_all_ingested_documents()
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

  delete from public.document_chunks;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.delete_all_ingested_documents() to authenticated;
