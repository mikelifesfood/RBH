-- Allow owners to resubmit when the previous reviewer can no longer review.
CREATE OR REPLACE FUNCTION public.rbh_submit_corrective_action_completion(p_action_id uuid, p_completion_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_user_org uuid;

  v_action public.report_corrective_actions%rowtype;
  v_report public.reports%rowtype;

  v_note text := nullif(btrim(coalesce(p_completion_note, '')), '');
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_note is null then
    raise exception 'COMPLETION_NOTE_REQUIRED';
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
    into v_action
  from public.report_corrective_actions a
  where a.id = p_action_id
  for update;

  if not found then
    raise exception 'CORRECTIVE_ACTION_NOT_FOUND';
  end if;

  select *
    into v_report
  from public.reports r
  where r.id = v_action.report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;

  if v_user_org is null
     or v_report.organization_id is null
     or v_user_org <> v_report.organization_id
     or v_action.organization_id <> v_report.organization_id then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if v_action.workflow_generation <> coalesce(v_report.workflow_restart_count, 0) then
    raise exception 'CORRECTIVE_ACTION_NOT_CURRENT_GENERATION';
  end if;

  if v_action.retired_at is not null then
    raise exception 'CORRECTIVE_ACTION_RETIRED';
  end if;

  if v_action.activated_at is null then
    raise exception 'CORRECTIVE_ACTION_NOT_ACTIVATED';
  end if;

  if v_action.activation_reopen_count is distinct from coalesce(v_report.reopen_count, 0) then
    raise exception 'CORRECTIVE_ACTION_NOT_CURRENT_REOPEN_CYCLE';
  end if;

  if v_report.status in ('closed','no_action','duplicate') then
    raise exception 'REPORT_ALREADY_RESOLVED';
  end if;

  if v_action.owner_user_id is null then
    raise exception 'CORRECTIVE_ACTION_OWNER_REQUIRED';
  end if;

  if v_role not in ('admin','safety_manager')
     and not (
       v_role = 'supervisor'
       and v_action.owner_user_id = v_uid
     ) then
    raise exception 'CORRECTIVE_ACTION_COMPLETION_NOT_AUTHORIZED';
  end if;

  if v_action.status not in ('not_started','in_progress','changes_requested') then
    raise exception 'CORRECTIVE_ACTION_NOT_OPEN_FOR_COMPLETION';
  end if;

  update public.report_corrective_actions a
  set
    status = 'awaiting_verification',
    completion_note = v_note,
    completed_at = v_now,
    completed_by = v_uid,

    -- A resubmission after changes requested starts a fresh verification cycle.
    -- Keep an eligible assignee. If the previous reviewer lost eligibility,
    -- return the action to the open review queue. The audit stores the old row.
    verifier_user_id = case
      when v_action.status = 'changes_requested' then (
        select p.id
        from public.profiles p
        where p.id = v_action.verifier_user_id
          and coalesce(p.is_active, true)
          and p.app_role in ('admin', 'safety_manager')
          and coalesce(p.current_organization_id, p.organization_id) = v_report.organization_id
      )
      else v_action.verifier_user_id
    end,
    verification_note = null,
    verified_at = null,
    verified_by = null,

    updated_at = v_now,
    updated_by = v_uid
  where a.id = p_action_id;

  return jsonb_build_object(
    'ok', true,
    'action_id', p_action_id,
    'report_id', v_action.report_id,
    'action_number', v_action.action_number,
    'status', 'awaiting_verification',
    'completed_at', v_now,
    'completed_by', v_uid
  );
end;
$function$;
