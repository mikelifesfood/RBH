-- RBH Safety - Build 44: Live dashboard sync, record presence, and conflict protection
-- Run in Supabase SQL Editor BEFORE deploying the Build 44 dashboard.
--
-- Purpose
--   * Publish a small, organization-scoped change feed for live dashboard updates.
--   * Track who currently has a report or corrective action open.
--   * Preserve the user who made a report/action change for conflict messaging.
--   * Keep presence soft (warning only) while allowing the UI to stop stale saves.
--
-- Notes
--   * Presence rows expire in the UI after ~55 seconds without a heartbeat.
--   * The change-event table keeps seven days of lightweight events.
--   * This migration does not change the RBH workflow, permissions, or business rules.

begin;

-- Build 44 uses updated_at as a lightweight optimistic-concurrency version.
-- Keep this additive/idempotent for older RBH databases.
alter table public.reports
  add column if not exists updated_at timestamptz not null default now();
alter table public.report_corrective_actions
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.rbh_build44_stamp_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Prefix with zz_ so existing validation/permission BEFORE UPDATE triggers run first.
drop trigger if exists zz_rbh_build44_reports_updated_at_trg on public.reports;
create trigger zz_rbh_build44_reports_updated_at_trg
before update on public.reports
for each row execute function public.rbh_build44_stamp_updated_at();

drop trigger if exists zz_rbh_build44_actions_updated_at_trg on public.report_corrective_actions;
create trigger zz_rbh_build44_actions_updated_at_trg
before update on public.report_corrective_actions
for each row execute function public.rbh_build44_stamp_updated_at();

create table if not exists public.rbh_record_presence (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  resource_type text not null check (resource_type in ('report','corrective_action')),
  resource_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  mode text not null default 'viewing' check (mode in ('viewing','editing')),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, resource_type, resource_id)
);

create index if not exists rbh_record_presence_report_idx
  on public.rbh_record_presence (organization_id, report_id, last_seen_at desc);

alter table public.rbh_record_presence enable row level security;
revoke all on table public.rbh_record_presence from public, anon, authenticated;
grant select on table public.rbh_record_presence to authenticated;

drop policy if exists rbh_record_presence_select_org on public.rbh_record_presence;
create policy rbh_record_presence_select_org
on public.rbh_record_presence
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.current_organization_id, p.organization_id) = rbh_record_presence.organization_id
  )
);

create or replace function public.rbh_touch_record_presence(
  p_resource_type text,
  p_resource_id uuid,
  p_report_id uuid,
  p_mode text default 'viewing'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_mode text := case when p_mode = 'editing' then 'editing' else 'viewing' end;
  v_valid boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    coalesce(p.current_organization_id, p.organization_id),
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Dashboard user')
  into v_org, v_name
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.is_active, true) = true;

  if v_org is null then
    raise exception 'ACTIVE_ORGANIZATION_REQUIRED';
  end if;

  if p_resource_type = 'report' then
    select exists (
      select 1 from public.reports r
      where r.id = p_resource_id
        and r.id = p_report_id
        and r.organization_id = v_org
    ) into v_valid;
  elsif p_resource_type = 'corrective_action' then
    select exists (
      select 1
      from public.report_corrective_actions a
      join public.reports r on r.id = a.report_id
      where a.id = p_resource_id
        and a.report_id = p_report_id
        and r.organization_id = v_org
        and a.retired_at is null
    ) into v_valid;
  else
    raise exception 'INVALID_RESOURCE_TYPE';
  end if;

  if not v_valid then
    raise exception 'RESOURCE_NOT_AVAILABLE';
  end if;

  -- Opportunistic cleanup keeps this lightweight table bounded without pg_cron.
  delete from public.rbh_record_presence
  where last_seen_at < now() - interval '1 day';

  insert into public.rbh_record_presence (
    organization_id, report_id, resource_type, resource_id,
    user_id, display_name, mode, last_seen_at
  ) values (
    v_org, p_report_id, p_resource_type, p_resource_id,
    v_uid, v_name, v_mode, now()
  )
  on conflict (user_id, resource_type, resource_id)
  do update set
    organization_id = excluded.organization_id,
    report_id = excluded.report_id,
    display_name = excluded.display_name,
    mode = excluded.mode,
    last_seen_at = excluded.last_seen_at;

  return true;
end;
$$;

revoke all on function public.rbh_touch_record_presence(text,uuid,uuid,text) from public, anon;
grant execute on function public.rbh_touch_record_presence(text,uuid,uuid,text) to authenticated;

create or replace function public.rbh_leave_record_presence(
  p_resource_type text,
  p_resource_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null then
    return false;
  end if;

  delete from public.rbh_record_presence
  where user_id = v_uid
    and resource_type = p_resource_type
    and resource_id = p_resource_id;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.rbh_leave_record_presence(text,uuid) from public, anon;
grant execute on function public.rbh_leave_record_presence(text,uuid) to authenticated;

create table if not exists public.rbh_record_change_events (
  id bigint generated by default as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  resource_type text not null check (resource_type in ('report','corrective_action')),
  resource_id uuid not null,
  event_type text not null check (event_type in ('INSERT','UPDATE','DELETE')),
  changed_by uuid references auth.users(id) on delete set null,
  resource_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists rbh_record_change_events_report_idx
  on public.rbh_record_change_events (organization_id, report_id, created_at desc);
create index if not exists rbh_record_change_events_resource_idx
  on public.rbh_record_change_events (resource_type, resource_id, created_at desc);

alter table public.rbh_record_change_events enable row level security;
revoke all on table public.rbh_record_change_events from public, anon, authenticated;
grant select on table public.rbh_record_change_events to authenticated;

drop policy if exists rbh_record_change_events_select_org on public.rbh_record_change_events;
create policy rbh_record_change_events_select_org
on public.rbh_record_change_events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true) = true
      and coalesce(p.current_organization_id, p.organization_id) = rbh_record_change_events.organization_id
  )
);

create or replace function public.rbh_emit_record_change_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_org uuid;
  v_report uuid;
  v_resource uuid;
  v_resource_type text;
  v_updated_at timestamptz;
begin
  if tg_table_name = 'reports' then
    if tg_op = 'DELETE' then
      v_org := old.organization_id;
      v_report := old.id;
      v_resource := old.id;
      v_updated_at := old.updated_at;
    else
      v_org := new.organization_id;
      v_report := new.id;
      v_resource := new.id;
      v_updated_at := new.updated_at;
    end if;
    v_resource_type := 'report';
  elsif tg_table_name = 'report_corrective_actions' then
    if tg_op = 'DELETE' then
      v_org := old.organization_id;
      v_report := old.report_id;
      v_resource := old.id;
      v_updated_at := old.updated_at;
    else
      v_org := new.organization_id;
      v_report := new.report_id;
      v_resource := new.id;
      v_updated_at := new.updated_at;
    end if;
    v_resource_type := 'corrective_action';
  else
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_org is not null and v_report is not null and v_resource is not null then
    insert into public.rbh_record_change_events (
      organization_id, report_id, resource_type, resource_id,
      event_type, changed_by, resource_updated_at
    ) values (
      v_org, v_report, v_resource_type, v_resource,
      tg_op, auth.uid(), v_updated_at
    );

    delete from public.rbh_record_change_events
    where created_at < now() - interval '7 days';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- These triggers only write the lightweight live-change feed. They do not alter
-- the report/action rows or existing workflow behavior.
drop trigger if exists rbh_build44_report_change_event_trg on public.reports;
create trigger rbh_build44_report_change_event_trg
after insert or update or delete on public.reports
for each row execute function public.rbh_emit_record_change_event();

drop trigger if exists rbh_build44_action_change_event_trg on public.report_corrective_actions;
create trigger rbh_build44_action_change_event_trg
after insert or update or delete on public.report_corrective_actions
for each row execute function public.rbh_emit_record_change_event();

-- Add only the small tables the browser needs to Supabase Realtime. The DO block
-- makes this safe to run more than once.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'rbh_record_change_events',
    'rbh_record_presence',
    'report_user_notifications'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

commit;

-- Validation query
select
  to_regclass('public.rbh_record_presence') is not null as presence_table_ready,
  to_regclass('public.rbh_record_change_events') is not null as change_event_table_ready,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rbh_touch_record_presence'
  ) as touch_presence_rpc_ready,
  exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='rbh_record_change_events'
  ) as change_events_realtime_ready,
  exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='rbh_record_presence'
  ) as presence_realtime_ready,
  exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='report_user_notifications'
  ) as notifications_realtime_ready;
