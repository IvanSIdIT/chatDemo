-- Fix: is_worker/is_manager must fall back to JWT user_metadata when accounts
-- table exists but the user row is missing (common after Auth-only user creation).

create or replace function public.is_manager()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.accounts') is not null then
    if exists (
      select 1
      from public.accounts
      where id = auth.uid() and role = 'manager'
    ) then
      return true;
    end if;
  end if;

  return coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager';
end;
$$;

create or replace function public.is_worker()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.accounts') is not null then
    if exists (
      select 1
      from public.accounts
      where id = auth.uid() and role = 'worker'
    ) then
      return true;
    end if;
  end if;

  return coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'worker';
end;
$$;

-- Backfill accounts for users created only via Auth (optional but recommended)
insert into public.accounts (id, email, role)
select
  u.id,
  u.email,
  (u.raw_user_meta_data ->> 'role')::public.user_role
from auth.users u
where (u.raw_user_meta_data ->> 'role') in ('worker', 'manager')
  and not exists (
    select 1 from public.accounts a where a.id = u.id
  )
on conflict (id) do nothing;
