-- Account roles for Factory Console
create type public.user_role as enum ('worker', 'manager');

-- Extends Supabase Auth users with app-specific account data
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role public.user_role not null,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create policy "Users can read own account"
  on public.accounts
  for select
  to authenticated
  using (auth.uid() = id);

-- Auto-create account row when a user signs up (role from user_metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_role public.user_role;
begin
  account_role := coalesce(
    (new.raw_user_meta_data ->> 'role')::public.user_role,
    'worker'::public.user_role
  );

  insert into public.accounts (id, email, role)
  values (new.id, new.email, account_role);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
