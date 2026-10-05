-- RBH Step 2 investigation simplification
-- Adds a structured "What happened?" investigation finding alongside the existing
-- root_cause field (now presented as "Why did it happen?").
--
-- Run this ONCE in the RBH Supabase SQL editor BEFORE deploying the matching
-- dashboard.html from Build 23.

begin;

alter table public.reports
  add column if not exists investigation_findings text;

comment on column public.reports.investigation_findings is
  'Investigator finding describing what the investigation determined actually happened.';

-- Preserve workflow position for records whose Investigation step was already
-- completed before this field existed. The original submitted description is used
-- as the legacy starting point and can be updated if the record is reopened.
update public.reports
set investigation_findings = nullif(btrim(description), '')
where investigation_findings is null
  and root_cause is not null
  and btrim(root_cause) <> ''
  and description is not null
  and btrim(description) <> '';

-- Keep the existing Supervisor step-boundary protection, while allowing an
-- assigned investigator to edit the new investigation_findings field in Step 2.
create or replace function public.rbh_guard_supervisor_report_step_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_is_investigator boolean := false;
  v_is_action_owner boolean := false;
  v_changed text[] := array[]::text[];
  v_allowed text[] := array[]::text[];
  v_bad text[] := array[]::text[];
begin
  if v_uid is null then
    return new;
  end if;

  v_role := public.rbh_current_app_role();

  if v_role in ('admin','safety_manager') then
    return new;
  end if;

  if v_role <> 'supervisor' then
    raise exception 'REPORT_UPDATE_NOT_ALLOWED_FOR_ROLE';
  end if;

  v_is_investigator := old.investigator_user_id is not distinct from v_uid;
  v_is_action_owner := old.assigned_user_id is not distinct from v_uid;

  if not v_is_investigator and not v_is_action_owner then
    raise exception 'REPORT_NOT_ASSIGNED_TO_SUPERVISOR';
  end if;

  select coalesce(array_agg(x.key order by x.key), array[]::text[])
    into v_changed
  from (
    select n.key
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
  ) x;

  v_allowed := array['updated_at'];

  if v_is_investigator then
    v_allowed := v_allowed || array[
      'investigation_findings',
      'root_cause',
      'corrective_action',
      'corrective_control_type',
      'assigned_user_id',
      'due_date',
      'priority',
      'action_status',
      'status',
      'reopen_workflow_step'
    ];
  end if;

  if v_is_action_owner then
    v_allowed := v_allowed || array[
      'action_completion_note',
      'action_status',
      'action_completed_at',
      'action_completed_by',
      'status',
      'reopen_workflow_step'
    ];
  end if;

  select coalesce(array_agg(c order by c), array[]::text[])
    into v_bad
  from unnest(v_changed) c
  where not (c = any(v_allowed));

  if coalesce(array_length(v_bad,1),0) > 0 then
    raise exception 'SUPERVISOR_STEP_FIELD_RESTRICTED: %', array_to_string(v_bad, ', ');
  end if;

  if v_is_investigator and not v_is_action_owner and new.status is distinct from old.status then
    if coalesce(new.status,'') not in ('under_review','assigned') then
      raise exception 'INVESTIGATOR_STATUS_TRANSITION_RESTRICTED';
    end if;
  end if;

  if v_is_investigator and not v_is_action_owner and new.action_status is distinct from old.action_status then
    if coalesce(new.action_status,'') not in ('not_started','in_progress') then
      raise exception 'INVESTIGATOR_ACTION_STATUS_RESTRICTED';
    end if;
  end if;

  if v_is_action_owner and new.status is distinct from old.status then
    if coalesce(new.status,'') <> 'corrective_action' then
      if not (v_is_investigator and new.status in ('under_review','assigned')) then
        raise exception 'ACTION_OWNER_STATUS_TRANSITION_RESTRICTED';
      end if;
    end if;
  end if;

  if v_is_action_owner and new.action_status is distinct from old.action_status then
    if coalesce(new.action_status,'') not in ('not_started','in_progress','awaiting_verification') then
      if not (v_is_investigator and new.action_status in ('not_started','in_progress')) then
        raise exception 'ACTION_OWNER_ACTION_STATUS_RESTRICTED';
      end if;
    end if;
  end if;

  if new.action_completed_by is distinct from old.action_completed_by
     and v_is_action_owner
     and new.action_completed_by is not null
     and new.action_completed_by <> v_uid then
    raise exception 'ACTION_COMPLETED_BY_MUST_MATCH_CURRENT_USER';
  end if;

  return new;
end;
$$;

-- A full workflow restart intentionally clears the new current-workflow finding,
-- while a normal reopen keeps it available for confirmation/update.
create or replace function public.rbh_clear_investigation_findings_on_restart()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.workflow_restart_count,0) > coalesce(old.workflow_restart_count,0) then
    new.investigation_findings := null;
  end if;
  return new;
end;
$$;

drop trigger if exists rbh_clear_investigation_findings_on_restart_trg on public.reports;
create trigger rbh_clear_investigation_findings_on_restart_trg
before update on public.reports
for each row
execute function public.rbh_clear_investigation_findings_on_restart();

commit;

-- Validation query (safe to run after the migration):
select
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reports' and column_name='investigation_findings'
  ) as investigation_findings_column,
  exists (
    select 1 from pg_trigger
    where tgname='rbh_clear_investigation_findings_on_restart_trg'
      and not tgisinternal
  ) as restart_clear_trigger;
