-- Applied in RBH Supabase on 2026-11-18.
-- Preserve report-owner authorization while avoiding legacy action mirror writes.

CREATE OR REPLACE FUNCTION public.rbh_activate_corrective_action_plan(p_report_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_org uuid;
  v_report public.reports%rowtype;
  v_action_count integer;
  v_incomplete_count integer;
  v_first public.report_corrective_actions%rowtype;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    p.app_role,
    coalesce(p.current_organization_id, p.organization_id)
  into
    v_role,
    v_user_org
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.is_active, true) = true;

  if v_role is null then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select *
    into v_report
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_user_org is null
     or v_report.organization_id is null
     or v_user_org <> v_report.organization_id then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if v_role not in ('admin','safety_manager') then
    raise exception 'CORRECTIVE_ACTION_PLAN_NOT_AUTHORIZED';
  end if;

  if v_report.report_owner_user_id is distinct from v_uid then
    raise exception 'REPORT_OWNER_REQUIRED_FOR_ACTION_PLAN';
  end if;

  if coalesce(v_report.status, 'new')
     not in ('under_review','assigned') then
    raise exception 'CORRECTIVE_ACTION_PLAN_NOT_READY_FOR_ACTIVATION';
  end if;

  select count(*)
    into v_action_count
  from public.report_corrective_actions a
  where a.report_id = p_report_id
    and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null;

  if v_action_count < 1 then
    raise exception 'AT_LEAST_ONE_CORRECTIVE_ACTION_REQUIRED';
  end if;

  select count(*)
    into v_incomplete_count
  from public.report_corrective_actions a
  where a.report_id = p_report_id
    and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null
    and (
         nullif(btrim(coalesce(a.description, '')), '') is null
      or a.control_type is null
      or a.owner_user_id is null
      or a.due_date is null
      or a.priority is null
    );

  if v_incomplete_count > 0 then
    raise exception 'CORRECTIVE_ACTION_PLAN_INCOMPLETE';
  end if;

  select *
    into v_first
  from public.report_corrective_actions a
  where a.report_id = p_report_id
    and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null
  order by a.action_number
  limit 1;

  -- Activate first. The child notification trigger creates one independent
  -- action-specific in-app assignment alert per owner. If the later report update
  -- fails, the entire transaction rolls back, including these alerts.
  update public.report_corrective_actions a
  set
    activated_at = v_now,
    activated_by = v_uid,
    activation_reopen_count = coalesce(v_report.reopen_count, 0),
    updated_at = v_now,
    updated_by = v_uid
  where a.report_id = p_report_id
    and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null
    and (
      a.activated_at is null
      or a.activation_reopen_count is distinct from coalesce(v_report.reopen_count, 0)
    );

  -- Temporary compatibility bridge until Step 14 moves completion/verification
  -- fully onto child actions. Action #1 mirrors to the original report fields so
  -- the existing Step 4/5 code remains functional during the staged cutover.
  perform set_config('rbh.plan_activation_bridge', v_uid::text, true);
  update public.reports
  set
    corrective_action = v_first.description,
    corrective_control_type = v_first.control_type,
    assigned_user_id = v_first.owner_user_id,
    due_date = v_first.due_date,
    priority = v_first.priority,
    action_status = case
      when coalesce(action_status, 'not_started') in ('not_started','in_progress')
        then 'in_progress'
      else action_status
    end,
    status = 'assigned',
    reopen_workflow_step = case
      when reopen_workflow_step is not null then 4
      else reopen_workflow_step
    end
  where id = p_report_id;
  perform set_config('rbh.plan_activation_bridge', '', true);

  -- The existing report-level producer may create the legacy single-action alert
  -- when assigned_user_id changes. Supersede it inside the same transaction so
  -- only the action-specific alerts are visible after multi-action activation.
  update public.report_user_notifications
     set resolved_at = coalesce(resolved_at, v_now),
         resolution_reason = coalesce(resolution_reason, 'superseded_by_multi_action')
   where report_id = p_report_id
     and corrective_action_id is null
     and notification_type = 'action_assignment'
     and resolved_at is null;

  return jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'workflow_generation', coalesce(v_report.workflow_restart_count, 0),
    'action_count', v_action_count,
    'activated_at', v_now,
    'actions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'action_number', a.action_number,
          'description', a.description,
          'control_type', a.control_type,
          'owner_user_id', a.owner_user_id,
          'due_date', a.due_date,
          'priority', a.priority,
          'status', a.status,
          'activated_at', a.activated_at,
          'activation_reopen_count', a.activation_reopen_count
        )
        order by a.action_number
      )
      from public.report_corrective_actions a
      where a.report_id = p_report_id
        and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
        and a.retired_at is null
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rbh_save_corrective_action_plan(p_report_id uuid, p_actions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_org uuid;
  v_report public.reports%rowtype;

  v_item jsonb;
  v_action_id uuid;
  v_id_text text;
  v_description text;
  v_control_type text;
  v_owner_user_id uuid;
  v_owner_text text;
  v_due_date date;
  v_due_text text;
  v_priority text;

  v_owner_role text;
  v_owner_active boolean;
  v_owner_org uuid;

  v_existing public.report_corrective_actions%rowtype;
  v_keep_ids uuid[] := array[]::uuid[];
  v_next_number integer;

  v_saved_count integer := 0;
  v_retired_count integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    p.app_role,
    coalesce(p.current_organization_id, p.organization_id)
  into
    v_role,
    v_user_org
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.is_active, true) = true;

  if v_role is null then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  select *
    into v_report
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_user_org is null
     or v_report.organization_id is null
     or v_user_org <> v_report.organization_id then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if v_role not in ('admin','safety_manager') then
    raise exception 'CORRECTIVE_ACTION_PLAN_NOT_AUTHORIZED';
  end if;

  if v_report.report_owner_user_id is distinct from v_uid then
    raise exception 'REPORT_OWNER_REQUIRED_FOR_ACTION_PLAN';
  end if;

  if coalesce(v_report.status, 'new')
     not in ('new','under_review','assigned') then
    raise exception 'CORRECTIVE_ACTION_PLAN_STAGE_CLOSED';
  end if;

  if p_actions is null
     or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'CORRECTIVE_ACTION_PLAN_ARRAY_REQUIRED';
  end if;

  if jsonb_array_length(p_actions) < 1 then
    raise exception 'AT_LEAST_ONE_CORRECTIVE_ACTION_REQUIRED';
  end if;

  if jsonb_array_length(p_actions) > 25 then
    raise exception 'TOO_MANY_CORRECTIVE_ACTIONS';
  end if;

  -- Duplicate existing IDs in the same payload are never valid.
  if exists (
    select 1
    from (
      select nullif(btrim(x.value ->> 'id'), '') as action_id_text,
             count(*) as n
      from jsonb_array_elements(p_actions) x(value)
      where nullif(btrim(x.value ->> 'id'), '') is not null
      group by nullif(btrim(x.value ->> 'id'), '')
      having count(*) > 1
    ) d
  ) then
    raise exception 'DUPLICATE_CORRECTIVE_ACTION_ID';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'CORRECTIVE_ACTION_OBJECT_REQUIRED';
    end if;

    v_id_text := nullif(btrim(v_item ->> 'id'), '');
    v_action_id := null;

    if v_id_text is not null then
      begin
        v_action_id := v_id_text::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_CORRECTIVE_ACTION_ID';
      end;
    end if;

    v_description := nullif(btrim(coalesce(v_item ->> 'description', '')), '');

    if v_description is null then
      raise exception 'CORRECTIVE_ACTION_DESCRIPTION_REQUIRED';
    end if;

    v_control_type := nullif(btrim(coalesce(v_item ->> 'control_type', '')), '');

    if v_control_type is not null
       and v_control_type not in (
         'elimination',
         'substitution',
         'engineering',
         'administrative',
         'ppe',
         'other'
       ) then
      raise exception 'INVALID_CORRECTIVE_CONTROL_TYPE';
    end if;

    v_priority := nullif(btrim(coalesce(v_item ->> 'priority', '')), '');

    if v_priority is not null
       and v_priority not in ('low','medium','high') then
      raise exception 'INVALID_CORRECTIVE_ACTION_PRIORITY';
    end if;

    v_due_text := nullif(btrim(coalesce(v_item ->> 'due_date', '')), '');
    v_due_date := null;

    if v_due_text is not null then
      begin
        v_due_date := v_due_text::date;
      exception when others then
        raise exception 'INVALID_CORRECTIVE_ACTION_DUE_DATE';
      end;
    end if;

    v_owner_text := nullif(btrim(coalesce(v_item ->> 'owner_user_id', '')), '');
    v_owner_user_id := null;

    if v_owner_text is not null then
      begin
        v_owner_user_id := v_owner_text::uuid;
      exception when invalid_text_representation then
        raise exception 'INVALID_CORRECTIVE_ACTION_OWNER_ID';
      end;

      select
        p.app_role,
        coalesce(p.is_active, true),
        coalesce(p.current_organization_id, p.organization_id)
      into
        v_owner_role,
        v_owner_active,
        v_owner_org
      from public.profiles p
      where p.id = v_owner_user_id;

      if not found then
        raise exception 'CORRECTIVE_ACTION_OWNER_NOT_FOUND';
      end if;

      if not v_owner_active then
        raise exception 'CORRECTIVE_ACTION_OWNER_INACTIVE';
      end if;

      if v_owner_role not in ('admin','safety_manager','supervisor') then
        raise exception 'CORRECTIVE_ACTION_OWNER_ROLE_NOT_ALLOWED';
      end if;

      if v_owner_org is null
         or v_owner_org <> v_report.organization_id then
        raise exception 'CORRECTIVE_ACTION_OWNER_ORGANIZATION_MISMATCH';
      end if;
    end if;

    if v_action_id is not null then
      select *
        into v_existing
      from public.report_corrective_actions a
      where a.id = v_action_id
      for update;

      if not found
         or v_existing.report_id <> p_report_id
         or v_existing.workflow_generation
            <> coalesce(v_report.workflow_restart_count, 0) then
        raise exception 'CORRECTIVE_ACTION_NOT_IN_CURRENT_REPORT_GENERATION';
      end if;

      if v_existing.retired_at is not null then
        raise exception 'RETIRED_CORRECTIVE_ACTION_CANNOT_BE_EDITED';
      end if;

      if v_existing.status not in ('not_started','in_progress') then
        raise exception 'CORRECTIVE_ACTION_LOCKED_BY_PROGRESS';
      end if;

      update public.report_corrective_actions a
      set
        description = v_description,
        control_type = v_control_type,
        owner_user_id = v_owner_user_id,
        due_date = v_due_date,
        priority = v_priority,
        updated_at = now(),
        updated_by = v_uid
      where a.id = v_existing.id
        and (
             a.description is distinct from v_description
          or a.control_type is distinct from v_control_type
          or a.owner_user_id is distinct from v_owner_user_id
          or a.due_date is distinct from v_due_date
          or a.priority is distinct from v_priority
        );

      v_keep_ids := array_append(v_keep_ids, v_existing.id);
      v_saved_count := v_saved_count + 1;

    else
      select coalesce(max(a.action_number), 0) + 1
        into v_next_number
      from public.report_corrective_actions a
      where a.report_id = p_report_id
        and a.workflow_generation
            = coalesce(v_report.workflow_restart_count, 0);

      insert into public.report_corrective_actions (
        report_id,
        organization_id,
        workflow_generation,
        action_number,
        description,
        control_type,
        owner_user_id,
        due_date,
        priority,
        status,
        source,
        created_by,
        updated_by
      ) values (
        p_report_id,
        v_report.organization_id,
        coalesce(v_report.workflow_restart_count, 0),
        v_next_number,
        v_description,
        v_control_type,
        v_owner_user_id,
        v_due_date,
        v_priority,
        'not_started',
        'native',
        v_uid,
        v_uid
      )
      returning id into v_action_id;

      v_keep_ids := array_append(v_keep_ids, v_action_id);
      v_saved_count := v_saved_count + 1;
    end if;
  end loop;

  -- Never silently retire work that has moved beyond the planning stage.
  if exists (
    select 1
    from public.report_corrective_actions a
    where a.report_id = p_report_id
      and a.workflow_generation
          = coalesce(v_report.workflow_restart_count, 0)
      and a.retired_at is null
      and not (a.id = any(v_keep_ids))
      and a.status not in ('not_started','in_progress')
  ) then
    raise exception 'CORRECTIVE_ACTION_PLAN_CONTAINS_LOCKED_OMISSION';
  end if;

  update public.report_corrective_actions a
  set
    retired_at = now(),
    retired_by = v_uid,
    updated_at = now(),
    updated_by = v_uid
  where a.report_id = p_report_id
    and a.workflow_generation
        = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null
    and not (a.id = any(v_keep_ids))
    and a.status in ('not_started','in_progress');

  get diagnostics v_retired_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'workflow_generation', coalesce(v_report.workflow_restart_count, 0),
    'saved_count', v_saved_count,
    'retired_count', v_retired_count,
    'actions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'action_number', a.action_number,
          'description', a.description,
          'control_type', a.control_type,
          'owner_user_id', a.owner_user_id,
          'due_date', a.due_date,
          'priority', a.priority,
          'status', a.status
        )
        order by a.action_number
      )
      from public.report_corrective_actions a
      where a.report_id = p_report_id
        and a.workflow_generation
            = coalesce(v_report.workflow_restart_count, 0)
        and a.retired_at is null
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rbh_sync_legacy_first_action_to_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_action_id uuid;
begin
  -- Plan activation has already populated the child actions. Do not mirror
  -- parent summary values back into another employee's activated action.
  if auth.uid() is not null and
     coalesce(current_setting('rbh.plan_activation_bridge', true), '') = auth.uid()::text then
    return new;
  end if;
  select a.id
    into v_action_id
  from public.report_corrective_actions a
  where a.report_id = new.id
    and a.workflow_generation = coalesce(new.workflow_restart_count, 0)
    and a.action_number = 1
    and a.retired_at is null
    and a.activated_at is not null
  limit 1;

  if v_action_id is null then
    return new;
  end if;

  update public.report_corrective_actions a
  set
    description = new.corrective_action,
    control_type = new.corrective_control_type,
    owner_user_id = new.assigned_user_id,
    due_date = new.due_date,
    priority = new.priority,
    status = coalesce(new.action_status, 'not_started'),
    completion_note = new.action_completion_note,
    completed_at = new.action_completed_at,
    completed_by = new.action_completed_by,
    verifier_user_id = new.verifier_user_id,
    verification_note = new.action_verification_note,
    verified_at = new.action_verified_at,
    verified_by = new.action_verified_by,
    updated_at = now(),
    updated_by = auth.uid()
  where a.id = v_action_id
    and (
         a.description is distinct from new.corrective_action
      or a.control_type is distinct from new.corrective_control_type
      or a.owner_user_id is distinct from new.assigned_user_id
      or a.due_date is distinct from new.due_date
      or a.priority is distinct from new.priority
      or a.status is distinct from coalesce(new.action_status, 'not_started')
      or a.completion_note is distinct from new.action_completion_note
      or a.completed_at is distinct from new.action_completed_at
      or a.completed_by is distinct from new.action_completed_by
      or a.verifier_user_id is distinct from new.verifier_user_id
      or a.verification_note is distinct from new.action_verification_note
      or a.verified_at is distinct from new.action_verified_at
      or a.verified_by is distinct from new.action_verified_by
    );

  return new;
end;
$function$;
