-- Employee messages for worker → manager workflow
-- Depends on: public.accounts (20250623000000_create_accounts.sql) or JWT user_metadata roles

create type public.message_status as enum ('pending', 'reviewed');

create table public.employee_messages (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  status public.message_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index employee_messages_employee_id_idx
  on public.employee_messages (employee_id);

create index employee_messages_created_at_idx
  on public.employee_messages (created_at desc);

create index employee_messages_employee_created_idx
  on public.employee_messages (employee_id, created_at desc);

-- Role helpers: accounts table is canonical; JWT metadata is fallback
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

create or replace function public.enforce_employee_message_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.employee_id := auth.uid();
  return new;
end;
$$;

create trigger employee_messages_set_owner
  before insert on public.employee_messages
  for each row
  execute function public.enforce_employee_message_owner();

alter table public.employee_messages enable row level security;

create policy "Workers can insert own messages"
  on public.employee_messages
  for insert
  to authenticated
  with check (public.is_worker() and employee_id = auth.uid());

create policy "Workers can read own messages"
  on public.employee_messages
  for select
  to authenticated
  using (public.is_worker() and employee_id = auth.uid());

create policy "Managers can read all messages"
  on public.employee_messages
  for select
  to authenticated
  using (public.is_manager());

-- Allow managers to resolve employee emails on the dashboard
do $$
begin
  if to_regclass('public.accounts') is not null
    and not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'accounts'
        and policyname = 'Managers can read all accounts'
    ) then
    execute $policy$
      create policy "Managers can read all accounts"
        on public.accounts
        for select
        to authenticated
        using (public.is_manager())
    $policy$;
  end if;
end $$;

alter table public.employee_messages replica identity full;

alter publication supabase_realtime add table public.employee_messages;
