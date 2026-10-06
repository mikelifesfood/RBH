-- RBH Safety — Build 37: Corrective-Action Decision / No-Additional-Action Path
-- Date: 2026-10-05
-- Run AFTER RBH_BUILD36_INJURY_REGULATORY_FOLLOWUP_V1.sql and BEFORE deploying Build 37 dashboard.html.
--
-- PURPOSE
--   Step 3 now begins with a documented decision:
--     1) Corrective action is required, OR
--     2) No additional corrective action is needed.
--
--   "No additional corrective action" is NOT a skip. It requires a reason and
--   explanation, is recorded in the report/audit history, and only moves the
--   workflow to the final Close step. It does not automatically close the record.
--
--   This migration also preserves the existing server-side close guard: when
--   corrective actions are required, every active current-cycle action must be
--   verified. When no additional action is documented, there must be no active
--   corrective-action rows for the current workflow generation.

begin;

-- -----------------------------------------------------------------------------
-- 1) REPORT-LEVEL DECISION FIELDS
-- -----------------------------------------------------------------------------
alter table public.reports
  add column if not exists corrective_action_decision text,
  add column if not exists corrective_action_no_action_reason text,
  add column if not exists corrective_action_no_action_note text,
  add column if not exists corrective_action_decided_at timestamptz,
  add column if not exists corrective_action_decided_by uuid;

-- Add the actor FK safely for projects where the column may already exist from a
-- partially applied migration.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reports_corrective_action_decided_by_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_corrective_action_decided_by_fkey
      foreign key (corrective_action_decided_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

alter table public.reports
  drop constraint if exists reports_corrective_action_decision_check;
alter table public.reports
  add constraint reports_corrective_action_decision_check
  check (
    corrective_action_decision is null
    or corrective_action_decision in ('required','not_required')
  );

alter table public.reports
  drop constraint if exists reports_corrective_action_no_action_reason_check;
alter table public.reports
  add constraint reports_corrective_action_no_action_reason_check
  check (
    corrective_action_no_action_reason is null
    or corrective_action_no_action_reason in (
      'corrected_immediately',
      'no_unsafe_condition',
      'existing_action',
      'duplicate_or_previously_addressed',
      'other'
    )
  );

alter table public.reports
  drop constraint if exists reports_corrective_action_decision_consistency_check;
alter table public.reports
  add constraint reports_corrective_action_decision_consistency_check
  check (
    (
      corrective_action_decision is null
      and corrective_action_no_action_reason is null
      and corrective_action_no_action_note is null
      and corrective_action_decided_at is null
      and corrective_action_decided_by is null
    )
    or
    (
      corrective_action_decision = 'required'
      and corrective_action_no_action_reason is null
      and corrective_action_no_action_note is null
      and corrective_action_decided_at is not null
      and corrective_action_decided_by is not null
    )
    or
    (
      corrective_action_decision = 'not_required'
      and corrective_action_no_action_reason is not null
      and nullif(btrim(coalesce(corrective_action_no_action_note,'')), '') is not null
      and corrective_action_decided_at is not null
      and corrective_action_decided_by is not null
    )
  );

comment on column public.reports.corrective_action_decision is
  'Step 3 decision: required or not_required. No-action is documented, not a workflow skip.';
comment on column public.reports.corrective_action_no_action_reason is
  'Structured reason for a Step 3 no-additional-corrective-action determination.';
comment on column public.reports.corrective_action_no_action_note is
  'Required explanation supporting a Step 3 no-additional-corrective-action determination.';

-- -----------------------------------------------------------------------------
-- 2) DIRECT-WRITE SAFETY VALIDATION
-- -----------------------------------------------------------------------------
-- The UI uses the RPC below, but direct API updates still must obey the same
-- consistency rules. SQL-editor/service-role maintenance (auth.uid() is null)
-- remains possible for controlled administrative work.
create or replace function public.rbh_validate_corrective_action_decision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_uid uuid := auth.uid();
  v_conflicting_actions integer := 0;
begin
  if new.corrective_action_decision is not distinct from old.corrective_action_decision
     and new.corrective_action_no_action_reason is not distinct from old.corrective_action_no_action_reason
     and new.corrective_action_no_action_note is not distinct from old.corrective_action_no_action_note
     and new.corrective_action_decided_at is not distinct from old.corrective_action_decided_at
     and new.corrective_action_decided_by is not distinct from old.corrective_action_decided_by then
    return new;
  end if;

  -- Cycle-reset triggers may deliberately clear the decision before this trigger
  -- runs. A fully-cleared state is valid and will require a fresh Step 3 decision.
  if new.corrective_action_decision is null then
    return new;
  end if;

  if v_uid is not null then
    if new.corrective_action_decided_by is distinct from v_uid then
      raise exception 'CORRECTIVE_ACTION_DECISION_ACTOR_MUST_MATCH_CURRENT_USER';
    end if;
    if new.corrective_action_decided_at is null
       or abs(extract(epoch from (now() - new.corrective_action_decided_at))) > 600 then
      raise exception 'CORRECTIVE_ACTION_DECISION_TIMESTAMP_INVALID';
    end if;
  end if;

  if new.corrective_action_decision = 'not_required' then
    if new.corrective_action_no_action_reason is null
       or new.corrective_action_no_action_reason not in (
         'corrected_immediately',
         'no_unsafe_condition',
         'existing_action',
         'duplicate_or_previously_addressed',
         'other'
       ) then
      raise exception 'CORRECTIVE_ACTION_NO_ACTION_REASON_REQUIRED';
    end if;

    if nullif(btrim(coalesce(new.corrective_action_no_action_note,'')), '') is null then
      raise exception 'CORRECTIVE_ACTION_NO_ACTION_EXPLANATION_REQUIRED';
    end if;

    select count(*)
      into v_conflicting_actions
    from public.report_corrective_actions a
    where a.report_id = new.id
      and a.workflow_generation = coalesce(new.workflow_restart_count, 0)
      and a.retired_at is null;

    if v_conflicting_actions > 0 then
      raise exception 'CORRECTIVE_ACTION_ROWS_MUST_BE_RETIRED_BEFORE_NO_ACTION';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists rbh_validate_corrective_action_decision_trg on public.reports;
create trigger rbh_validate_corrective_action_decision_trg
before update of
  corrective_action_decision,
  corrective_action_no_action_reason,
  corrective_action_no_action_note,
  corrective_action_decided_at,
  corrective_action_decided_by
on public.reports
for each row
execute function public.rbh_validate_corrective_action_decision();

-- -----------------------------------------------------------------------------
-- 3) CONTROLLED STEP-3 DECISION RPC
-- -----------------------------------------------------------------------------
create or replace function public.rbh_set_corrective_action_decision(
  p_report_id uuid,
  p_decision text,
  p_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_org uuid;
  v_report public.reports%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
  v_activated integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.rbh_current_user_active() then
    raise exception 'ACTIVE_USER_REQUIRED';
  end if;

  v_role := public.rbh_current_app_role();
  v_org := public.rbh_current_organization_id();

  select r.*
    into v_report
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  if v_org is null or v_report.organization_id is distinct from v_org then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if v_report.status in ('closed','no_action','duplicate') then
    raise exception 'REPORT_ALREADY_RESOLVED';
  end if;

  if v_role not in ('admin','safety_manager','supervisor') then
    raise exception 'CORRECTIVE_ACTION_DECISION_NOT_ALLOWED';
  end if;
  if v_role = 'supervisor'
     and v_report.investigator_user_id is distinct from v_uid then
    raise exception 'INVESTIGATOR_REQUIRED';
  end if;

  -- Step 2 must be complete before Step 3 can be decided.
  if nullif(btrim(coalesce(v_report.investigation_findings,'')), '') is null
     or nullif(btrim(coalesce(v_report.root_cause,'')), '') is null then
    raise exception 'INVESTIGATION_MUST_BE_COMPLETED_FIRST';
  end if;

  if p_decision not in ('required','not_required') then
    raise exception 'INVALID_CORRECTIVE_ACTION_DECISION';
  end if;

  if p_decision = 'required' then
    update public.reports
    set corrective_action_decision = 'required',
        corrective_action_no_action_reason = null,
        corrective_action_no_action_note = null,
        corrective_action_decided_at = v_now,
        corrective_action_decided_by = v_uid
    where id = p_report_id;

  else
    if v_reason is null
       or v_reason not in (
         'corrected_immediately',
         'no_unsafe_condition',
         'existing_action',
         'duplicate_or_previously_addressed',
         'other'
       ) then
      raise exception 'CORRECTIVE_ACTION_NO_ACTION_REASON_REQUIRED';
    end if;
    if v_note is null then
      raise exception 'CORRECTIVE_ACTION_NO_ACTION_EXPLANATION_REQUIRED';
    end if;

    -- Never silently discard an action that has already been activated/assigned.
    select count(*)
      into v_activated
    from public.report_corrective_actions a
    where a.report_id = p_report_id
      and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
      and a.retired_at is null
      and a.activated_at is not null;

    if v_activated > 0 then
      raise exception 'ACTIVE_CORRECTIVE_ACTIONS_ALREADY_EXIST';
    end if;

    -- Draft child rows may exist because the UI prepares an empty action card.
    -- Retire those drafts rather than deleting them, preserving a clean audit trail.
    update public.report_corrective_actions a
    set retired_at = coalesce(a.retired_at, v_now),
        updated_at = v_now,
        updated_by = v_uid
    where a.report_id = p_report_id
      and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
      and a.retired_at is null
      and a.activated_at is null;

    update public.reports
    set corrective_action_decision = 'not_required',
        corrective_action_no_action_reason = v_reason,
        corrective_action_no_action_note = v_note,
        corrective_action_decided_at = v_now,
        corrective_action_decided_by = v_uid,
        -- Clear only legacy Step 3 draft compatibility fields. Step 1/2 history is untouched.
        corrective_action = null,
        corrective_control_type = null,
        assigned_user_id = null,
        responsible_person = null,
        due_date = null,
        priority = null,
        action_status = 'not_started'
    where id = p_report_id;
  end if;

  return (
    select jsonb_build_object(
      'ok', true,
      'report_id', r.id,
      'corrective_action_decision', r.corrective_action_decision,
      'corrective_action_no_action_reason', r.corrective_action_no_action_reason,
      'corrective_action_no_action_note', r.corrective_action_no_action_note,
      'corrective_action_decided_at', r.corrective_action_decided_at,
      'corrective_action_decided_by', r.corrective_action_decided_by,
      'corrective_action', r.corrective_action,
      'corrective_control_type', r.corrective_control_type,
      'assigned_user_id', r.assigned_user_id,
      'due_date', r.due_date,
      'priority', r.priority,
      'action_status', r.action_status
    )
    from public.reports r
    where r.id = p_report_id
  );
end;
$function$;

revoke all on function public.rbh_set_corrective_action_decision(uuid,text,text,text)
  from public, anon;
grant execute on function public.rbh_set_corrective_action_decision(uuid,text,text,text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4) CLEAR THE DECISION WHEN A NEW WORKFLOW/REOPEN CYCLE STARTS
-- -----------------------------------------------------------------------------
-- A restart or reopen means management must consciously make the Step 3 decision
-- again. Previous values stay preserved in report_audit / notes history.
create or replace function public.rbh_clear_corrective_action_decision_on_cycle_reset()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  if coalesce(new.workflow_restart_count,0) > coalesce(old.workflow_restart_count,0)
     or coalesce(new.reopen_count,0) > coalesce(old.reopen_count,0) then
    new.corrective_action_decision := null;
    new.corrective_action_no_action_reason := null;
    new.corrective_action_no_action_note := null;
    new.corrective_action_decided_at := null;
    new.corrective_action_decided_by := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists rbh_clear_corrective_action_decision_on_cycle_reset_trg on public.reports;
create trigger rbh_clear_corrective_action_decision_on_cycle_reset_trg
before update of workflow_restart_count, reopen_count
on public.reports
for each row
execute function public.rbh_clear_corrective_action_decision_on_cycle_reset();

-- -----------------------------------------------------------------------------
-- 5) SUPERVISOR FIELD BOUNDARY — ALLOW THE INVESTIGATOR TO MAKE STEP-3 DECISION
-- -----------------------------------------------------------------------------
-- Recreate the existing guard with the Build 37 decision fields added to the
-- investigator's allowed Step 1-3 field set. Admin/Safety Manager remain unchanged.
create or replace function public.rbh_guard_supervisor_report_step_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
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
      'corrective_action_decision',
      'corrective_action_no_action_reason',
      'corrective_action_no_action_note',
      'corrective_action_decided_at',
      'corrective_action_decided_by',
      'corrective_action',
      'corrective_control_type',
      'assigned_user_id',
      'responsible_person',
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
$function$;

-- Existing trigger keeps calling this function; recreate defensively if absent.
drop trigger if exists rbh_guard_supervisor_report_step_fields_trg on public.reports;
create trigger rbh_guard_supervisor_report_step_fields_trg
before update on public.reports
for each row
execute function public.rbh_guard_supervisor_report_step_fields();

-- -----------------------------------------------------------------------------
-- 6) CLOSE GUARD — SUPPORT BOTH DOCUMENTED PATHS
-- -----------------------------------------------------------------------------
create or replace function public.rbh_guard_close_requires_all_actions_verified()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_total integer := 0;
  v_verified integer := 0;
begin
  if new.status = 'closed'
     and new.status is distinct from old.status then

    select
      count(*),
      count(*) filter (
        where a.activated_at is not null
          and a.activation_reopen_count = coalesce(new.reopen_count, 0)
          and a.status = 'verified'
      )
    into v_total, v_verified
    from public.report_corrective_actions a
    where a.report_id = new.id
      and a.workflow_generation = coalesce(new.workflow_restart_count, 0)
      and a.retired_at is null;

    if new.corrective_action_decision = 'not_required' then
      if new.corrective_action_no_action_reason is null
         or nullif(btrim(coalesce(new.corrective_action_no_action_note,'')), '') is null then
        raise exception 'NO_ADDITIONAL_ACTION_DECISION_MUST_BE_DOCUMENTED';
      end if;
      if v_total > 0 then
        raise exception 'NO_ADDITIONAL_ACTION_CONFLICTS_WITH_ACTIVE_CORRECTIVE_ACTIONS';
      end if;

    elsif new.corrective_action_decision = 'required' then
      if v_total < 1 then
        raise exception 'AT_LEAST_ONE_CORRECTIVE_ACTION_REQUIRED';
      end if;
      if v_verified <> v_total then
        raise exception
          'ALL_CORRECTIVE_ACTIONS_MUST_BE_VERIFIED: % of % verified',
          v_verified, v_total;
      end if;

    else
      -- Backward compatibility for older records created before Build 37.
      if v_total > 0 and v_verified <> v_total then
        raise exception
          'ALL_CORRECTIVE_ACTIONS_MUST_BE_VERIFIED: % of % verified',
          v_verified, v_total;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- The trigger already exists in production, but recreate it so a partially built
-- clone receives the same guard consistently.
drop trigger if exists rbh_guard_close_requires_all_actions_verified_trg on public.reports;
create trigger rbh_guard_close_requires_all_actions_verified_trg
before update of status
on public.reports
for each row
execute function public.rbh_guard_close_requires_all_actions_verified();

grant execute on function public.rbh_guard_close_requires_all_actions_verified() to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- READ-ONLY VALIDATION
-- Expected: all boolean columns = true.
-- -----------------------------------------------------------------------------
select
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reports'
      and column_name='corrective_action_decision'
  ) as decision_column_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reports'
      and column_name='corrective_action_no_action_reason'
  ) as reason_column_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reports'
      and column_name='corrective_action_no_action_note'
  ) as explanation_column_ready,
  to_regprocedure('public.rbh_set_corrective_action_decision(uuid,text,text,text)') is not null
    as decision_rpc_ready,
  to_regprocedure('public.rbh_guard_close_requires_all_actions_verified()') is not null
    as close_guard_ready,
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='reports'
      and t.tgname='rbh_clear_corrective_action_decision_on_cycle_reset_trg'
      and not t.tgisinternal
  ) as cycle_reset_trigger_ready,
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='reports'
      and t.tgname='rbh_guard_close_requires_all_actions_verified_trg'
      and not t.tgisinternal
  ) as close_guard_trigger_ready;
