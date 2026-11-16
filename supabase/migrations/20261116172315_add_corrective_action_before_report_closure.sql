-- Append a single action to a completed plan without rewriting its verified rows.
create or replace function public.rbh_add_corrective_action_before_close(
  p_report_id uuid, p_action_id uuid, p_description text, p_owner_user_id uuid,
  p_due_date date, p_priority text, p_control_type text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_report public.reports%rowtype;
  v_action public.report_corrective_actions%rowtype;
  v_generation integer;
  v_cycle integer;
  v_count integer;
  v_verified integer;
  v_number integer;
  v_description text := nullif(btrim(p_description), '');
begin
  select coalesce(p.current_organization_id, p.organization_id) into v_org
  from public.profiles p
  where p.id = v_user and p.is_active and p.app_role in ('admin', 'safety_manager');

  if v_org is null then
    raise exception 'CORRECTIVE_ACTION_PLAN_NOT_AUTHORIZED';
  end if;

  -- Serialize append and closure on the same parent row.
  select * into v_report from public.reports
  where id = p_report_id and organization_id = v_org for update;
  if not found or v_report.status not in ('under_review', 'assigned', 'corrective_action') then
    raise exception 'CORRECTIVE_ACTION_REPORT_NOT_OPEN';
  end if;
  if p_action_id is null or v_description is null or p_owner_user_id is null
     or p_due_date is null or p_priority is null or p_control_type is null
     or p_priority not in ('low', 'medium', 'high')
     or p_control_type not in ('elimination','substitution','engineering','administrative','ppe','other') then
    raise exception 'CORRECTIVE_ACTION_PLAN_INCOMPLETE';
  end if;

  v_generation := coalesce(v_report.workflow_restart_count, 0);
  v_cycle := coalesce(v_report.reopen_count, 0);
  select * into v_action from public.report_corrective_actions
  where id = p_action_id and report_id = p_report_id
    and workflow_generation = v_generation and activation_reopen_count = v_cycle
    and retired_at is null and created_by = v_user;
  if found then
    if v_action.description is distinct from v_description
       or v_action.owner_user_id is distinct from p_owner_user_id
       or v_action.due_date is distinct from p_due_date
       or v_action.priority is distinct from p_priority
       or v_action.control_type is distinct from p_control_type then
      raise exception 'CORRECTIVE_ACTION_REQUEST_ALREADY_USED';
    end if;
    return to_jsonb(v_action);
  end if;

  select count(*), count(*) filter (
    where status = 'verified' and activated_at is not null and activation_reopen_count = v_cycle
  ) into v_count, v_verified
  from public.report_corrective_actions
  where report_id = p_report_id and workflow_generation = v_generation and retired_at is null;

  if v_count >= 25 then
    raise exception 'TOO_MANY_CORRECTIVE_ACTIONS';
  end if;
  if v_count <> v_verified or coalesce(v_report.reopen_workflow_step, 6) < 5
     or (v_count = 0 and not (
       v_report.status = 'under_review'
       and v_report.corrective_action_decision is not distinct from 'not_required'
       and nullif(btrim(v_report.investigation_findings), '') is not null
       and nullif(btrim(v_report.root_cause), '') is not null
       and nullif(btrim(v_report.corrective_action_no_action_reason), '') is not null
       and nullif(btrim(v_report.corrective_action_no_action_note), '') is not null
     )) then
    raise exception 'CORRECTIVE_ACTION_APPEND_REQUIRES_CLOSE_STAGE';
  end if;

  if v_count = 0 then
    perform public.rbh_set_corrective_action_decision(p_report_id, 'required', null, null);
  end if;

  select coalesce(max(action_number), 0) + 1 into v_number
  from public.report_corrective_actions
  where report_id = p_report_id and workflow_generation = v_generation;

  -- The existing integrity trigger validates the new assignee and organization.
  insert into public.report_corrective_actions (
    id, report_id, organization_id, workflow_generation, action_number, description,
    control_type, owner_user_id, due_date, priority, status, source, created_by, updated_by
  ) values (
    p_action_id, p_report_id, v_org, v_generation, v_number, v_description,
    p_control_type, p_owner_user_id, p_due_date, p_priority, 'not_started', 'native', v_user, v_user
  );

  if v_count = 0 then
    -- The first action needs the same report-field bridge as a normal plan.
    perform public.rbh_activate_corrective_action_plan(p_report_id);
  else
    -- Activate only the new row and let the existing notification trigger run.
    update public.report_corrective_actions
    set activated_at = now(), activated_by = v_user, activation_reopen_count = v_cycle
    where id = p_action_id;
    if v_report.reopen_workflow_step is not null then
      update public.reports set reopen_workflow_step = 4 where id = p_report_id;
    end if;
  end if;

  select * into strict v_action from public.report_corrective_actions where id = p_action_id;
  return to_jsonb(v_action);
end;
$function$;

revoke all on function public.rbh_add_corrective_action_before_close(uuid,uuid,text,uuid,date,text,text) from public, anon;
grant execute on function public.rbh_add_corrective_action_before_close(uuid,uuid,text,uuid,date,text,text) to authenticated;
