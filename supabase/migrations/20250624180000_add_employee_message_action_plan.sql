-- AI-generated action plans for worker incident PDF reports.

alter table public.employee_messages
  add column if not exists action_plan text,
  add column if not exists action_plan_status text not null default 'none';

alter table public.employee_messages
  drop constraint if exists employee_messages_action_plan_status_check;

alter table public.employee_messages
  add constraint employee_messages_action_plan_status_check
  check (action_plan_status in ('none', 'generating', 'ready', 'failed'));
