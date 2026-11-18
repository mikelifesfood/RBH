-- STAGED ONLY: owner-enforced RPCs, data API policies and trigger guards.
-- Requires ownership transfer migrations. Tested in transaction rollback before release.
-- Applied after the existing business-data migrations; does not delete or rewrite records.

-- Harden rbh_set_report_owner
CREATE OR REPLACE FUNCTION public.rbh_set_report_owner(p_report_id uuid, p_owner_user_id uuid)
 RETURNS TABLE(report_owner_user_id uuid, report_owner_assigned_at timestamp with time zone, report_owner_assigned_by uuid, report_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_caller_active boolean;
  v_caller_org uuid;
  v_report_org uuid;
  v_report_status text;
  v_prior_owner uuid;
  v_owner_role text;
  v_owner_active boolean;
  v_owner_org uuid;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_report_id is null or p_owner_user_id is null then
    raise exception 'REPORT_AND_OWNER_REQUIRED';
  end if;

  select p.app_role, coalesce(p.is_active, true), p.organization_id
    into v_caller_role, v_caller_active, v_caller_org
  from public.profiles p
  where p.id = v_uid;

  if not found or not v_caller_active then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_caller_role not in ('admin','safety_manager') then
    raise exception 'MANAGER_ROLE_REQUIRED';
  end if;

  select r.organization_id, r.status, r.report_owner_user_id
    into v_report_org, v_report_status, v_prior_owner
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND';
  end if;
  if v_report_org is distinct from v_caller_org then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if coalesce(v_report_status,'') in ('closed','no_action','duplicate') then
    raise exception 'REPORT_IS_RESOLVED';
  end if;

  select p.app_role, coalesce(p.is_active, true), p.organization_id
    into v_owner_role, v_owner_active, v_owner_org
  from public.profiles p
  where p.id = p_owner_user_id;

  if not found then
    raise exception 'REPORT_OWNER_PROFILE_NOT_FOUND';
  end if;
  if not v_owner_active then
    raise exception 'REPORT_OWNER_MUST_BE_ACTIVE';
  end if;
  if v_owner_role not in ('admin','safety_manager') then
    raise exception 'REPORT_OWNER_MUST_BE_ADMIN_OR_SAFETY_MANAGER';
  end if;
  if v_owner_org is distinct from v_report_org then
    raise exception 'REPORT_OWNER_ORGANIZATION_MISMATCH';
  end if;

  if v_prior_owner is not null and v_prior_owner is distinct from v_uid
  then raise exception 'ONLY_CURRENT_OWNER_CAN_USE_LEGACY_ASSIGNMENT'; end if;
  if v_prior_owner is not null and v_prior_owner is distinct from p_owner_user_id
  then raise exception 'USE_REPORT_TRANSFER_REQUEST'; end if;
  if v_prior_owner is null and v_caller_role='safety_manager' and p_owner_user_id is distinct from v_uid
  then raise exception 'CLAIM_UNASSIGNED_REPORT_FIRST'; end if;
  perform set_config('rbh.authorized_owner_change',v_uid::text,true);
  update public.reports r
     set report_owner_user_id = p_owner_user_id,
         report_owner_assigned_at = v_now,
         report_owner_assigned_by = v_uid
   where r.id = p_report_id;

  return query
  select r.report_owner_user_id, r.report_owner_assigned_at, r.report_owner_assigned_by, r.updated_at
  from public.reports r
  where r.id = p_report_id;
end;
$function$;


-- Harden rbh_submit_corrective_action_completion
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

  if v_role not in ('admin','safety_manager','supervisor')
     or v_action.owner_user_id is distinct from v_uid then
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


-- Harden rbh_verify_corrective_action
CREATE OR REPLACE FUNCTION public.rbh_verify_corrective_action(p_action_id uuid, p_verification_note text)
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
  v_note text := nullif(btrim(coalesce(p_verification_note, '')), '');
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

  if v_role not in ('admin','safety_manager') then
    raise exception 'VERIFICATION_MANAGER_REQUIRED';
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

  if v_action.status <> 'awaiting_verification' then
    raise exception 'CORRECTIVE_ACTION_NOT_AWAITING_VERIFICATION';
  end if;

  -- Admin keeps the existing override. Safety Managers may work the shared queue
  -- or actions specifically assigned to them, but not an action assigned to
  -- another reviewer.
  if v_action.verifier_user_id is distinct from v_uid then
    raise exception 'VERIFICATION_OWNER_REQUIRED';
  end if;

  update public.report_corrective_actions a
  set
    status = 'verified',
    verifier_user_id = coalesce(a.verifier_user_id, v_uid),
    verification_note = v_note,
    verified_at = v_now,
    verified_by = v_uid,
    updated_at = v_now,
    updated_by = v_uid
  where a.id = p_action_id;

  return jsonb_build_object(
    'ok', true,
    'action_id', p_action_id,
    'report_id', v_action.report_id,
    'action_number', v_action.action_number,
    'status', 'verified',
    'verified_at', v_now,
    'verified_by', v_uid
  );
end;
$function$;


-- Harden rbh_request_corrective_action_changes
CREATE OR REPLACE FUNCTION public.rbh_request_corrective_action_changes(p_action_id uuid, p_verification_note text)
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
  v_note text := nullif(btrim(coalesce(p_verification_note, '')), '');
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_note is null then
    raise exception 'VERIFICATION_NOTE_REQUIRED';
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

  if v_role not in ('admin','safety_manager') then
    raise exception 'VERIFICATION_MANAGER_REQUIRED';
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

  if v_action.status <> 'awaiting_verification' then
    raise exception 'CORRECTIVE_ACTION_NOT_AWAITING_VERIFICATION';
  end if;

  if v_action.verifier_user_id is distinct from v_uid then
    raise exception 'VERIFICATION_OWNER_REQUIRED';
  end if;

  update public.report_corrective_actions a
  set
    status = 'changes_requested',
    verifier_user_id = coalesce(a.verifier_user_id, v_uid),
    verification_note = v_note,
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
    'status', 'changes_requested',
    'reviewed_at', v_now,
    'reviewed_by', v_uid
  );
end;
$function$;


-- Harden rbh_can_manage_corrective_action_plan
CREATE OR REPLACE FUNCTION public.rbh_can_manage_corrective_action_plan(p_report_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  select exists (
    select 1
    from public.reports r
    join public.profiles p
      on p.id = auth.uid()
    where r.id = p_report_id
      and auth.uid() is not null
      and coalesce(p.is_active, true) = true
      and coalesce(p.current_organization_id, p.organization_id)
          = r.organization_id
      and coalesce(r.status, 'new')
          in ('new','under_review','assigned')
      and (
        p.app_role in ('admin','safety_manager') and r.report_owner_user_id=p.id
      )
  );
$function$;


-- Harden rbh_set_corrective_action_verifier
CREATE OR REPLACE FUNCTION public.rbh_set_corrective_action_verifier(p_action_id uuid, p_verifier_user_id uuid)
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
  v_verifier_role text;
  v_verifier_active boolean;
  v_verifier_org uuid;
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

  if v_role not in ('admin','safety_manager') then
    raise exception 'VERIFICATION_MANAGER_REQUIRED';
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
     or v_user_org <> v_report.organization_id then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if v_report.report_owner_user_id is distinct from v_uid then
    raise exception 'REPORT_OWNER_REQUIRED_FOR_VERIFIER_ASSIGNMENT';
  end if;

  if v_action.workflow_generation <> coalesce(v_report.workflow_restart_count, 0)
     or v_action.retired_at is not null then
    raise exception 'CORRECTIVE_ACTION_NOT_CURRENT_ACTIVE';
  end if;

  if v_action.activated_at is null then
    raise exception 'CORRECTIVE_ACTION_NOT_ACTIVATED';
  end if;

  if v_action.activation_reopen_count is distinct from coalesce(v_report.reopen_count, 0) then
    raise exception 'CORRECTIVE_ACTION_NOT_CURRENT_REOPEN_CYCLE';
  end if;

  if p_verifier_user_id is not null then
    select
      p.app_role,
      coalesce(p.is_active, true),
      coalesce(p.current_organization_id, p.organization_id)
    into
      v_verifier_role,
      v_verifier_active,
      v_verifier_org
    from public.profiles p
    where p.id = p_verifier_user_id;

    if not found then
      raise exception 'VERIFIER_NOT_FOUND';
    end if;

    if not v_verifier_active then
      raise exception 'VERIFIER_INACTIVE';
    end if;

    if v_verifier_role not in ('admin','safety_manager') then
      raise exception 'VERIFIER_ROLE_NOT_ALLOWED';
    end if;

    if v_verifier_org is null or v_verifier_org <> v_report.organization_id then
      raise exception 'VERIFIER_ORGANIZATION_MISMATCH';
    end if;
  end if;

  update public.report_corrective_actions a
  set
    verifier_user_id = p_verifier_user_id,
    updated_at = now(),
    updated_by = v_uid
  where a.id = p_action_id;

  return jsonb_build_object(
    'ok', true,
    'action_id', p_action_id,
    'verifier_user_id', p_verifier_user_id
  );
end;
$function$;


-- Report writes are owner-restricted, including SECURITY DEFINER RPCs.
create or replace function public.rbh_enforce_report_current_owner()
returns trigger language plpgsql security definer set search_path='pg_catalog','public','auth' as $$
declare v_actor uuid:=auth.uid();v_role text;v_org uuid;v_trusted boolean;
begin
 if v_actor is null then return new; end if;
 select p.app_role,coalesce(p.current_organization_id,p.organization_id)
 into v_role,v_org from public.profiles p
 where p.id=v_actor and p.is_active is true and p.access_deleted_at is null;
 if v_role is null or v_org is distinct from old.organization_id then raise exception 'ACCESS_REVOKED_OR_WRONG_COMPANY'; end if;
 v_trusted=coalesce(current_setting('rbh.authorized_owner_change',true),'')=v_actor::text;
 if old.report_owner_user_id is distinct from new.report_owner_user_id then
   if not v_trusted and not (
     old.report_owner_user_id is null and new.report_owner_user_id=v_actor
     and v_role in ('admin','safety_manager')
   ) then raise exception 'OWNER_TRANSFER_REQUIRES_AUTHORIZED_WORKFLOW'; end if;
 else
   if old.report_owner_user_id is distinct from v_actor then
     raise exception 'REPORT_OWNER_REQUIRED_FOR_UPDATE';
   end if;
 end if;
 return new;
end; $$;
create trigger rbh_enforce_report_owner_before_write
before update on public.reports for each row
execute function public.rbh_enforce_report_current_owner();

drop policy if exists teamworkt_reports_update_authorized_same_org on public.reports;
create policy rbh_reports_update_current_owner on public.reports for update to authenticated
using (rbh_current_user_active() and organization_id=rbh_current_organization_id()
       and report_owner_user_id=(select auth.uid()))
with check (rbh_current_user_active() and organization_id=rbh_current_organization_id()
       and report_owner_user_id=(select auth.uid()));
-- SECURITY DEFINER owner transfer RPCs bypass RLS but NOT ownership trigger.

drop policy if exists teamworkt_notes_insert_authorized on public.report_notes;
create policy rbh_report_notes_insert_current_owner on public.report_notes for insert to authenticated
with check (rbh_current_user_active() and organization_id=rbh_current_organization_id()
and author_id=(select auth.uid()) and exists(select 1 from public.reports r
where r.id=report_id and r.organization_id=rbh_current_organization_id()
and r.report_owner_user_id=(select auth.uid())));

-- Prevent broad manager ability to alter actions after activation.
create or replace function public.rbh_enforce_corrective_action_owner()
returns trigger language plpgsql security definer set search_path='pg_catalog','public','auth' as $$
declare v_actor uuid:=auth.uid();v_role text;v_org uuid;v_report_owner uuid;v_report_status text;
 v_reassignment boolean;
begin
 if v_actor is null then return new; end if;
 select p.app_role,coalesce(p.current_organization_id,p.organization_id)
 into v_role,v_org from public.profiles p
 where p.id=v_actor and p.is_active is true and p.access_deleted_at is null;
 if v_role not in ('admin','safety_manager','supervisor') or v_org is distinct from new.organization_id
 then raise exception 'CORRECTIVE_ACTION_USER_NOT_AUTHORIZED'; end if;
 select r.report_owner_user_id,r.status into v_report_owner,v_report_status
 from public.reports r where r.id=new.report_id and r.organization_id=v_org;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 if tg_op='INSERT' then
   if v_report_owner is distinct from v_actor then raise exception 'REPORT_OWNER_REQUIRED_TO_CREATE_ACTION'; end if;
   return new;
 end if;
 if new.report_id is distinct from old.report_id or new.organization_id is distinct from old.organization_id
 then raise exception 'ACTION_IDENTITY_CANNOT_CHANGE'; end if;
 v_reassignment=coalesce(current_setting('rbh.authorized_action_reassignment',true),'')=v_actor::text;
 if new.owner_user_id is distinct from old.owner_user_id and old.activated_at is not null then
   if not v_reassignment or not (v_report_owner=v_actor or v_role='admin')
   then raise exception 'REASSIGNMENT_REQUIRES_REPORT_OWNER'; end if;
 end if;
 if old.activated_at is null and v_report_owner=v_actor then return new; end if;
 -- Existing completed action content is immutable except through the current
 -- assigned owner completion RPC or the explicitly assigned verifier RPC.
 if new.owner_user_id is distinct from old.owner_user_id then
    if not v_reassignment then raise exception 'ACTION_TRANSFER_NOT_AUTHORIZED'; end if;
    if new.description is distinct from old.description or new.due_date is distinct from old.due_date
       or new.priority is distinct from old.priority or new.control_type is distinct from old.control_type
       or new.status is distinct from old.status or new.completion_note is distinct from old.completion_note
       or new.verification_note is distinct from old.verification_note
    then raise exception 'REASSIGNMENT_MUST_NOT_EDIT_ACTION_CONTENT'; end if;
    return new;
 end if;
 if new.status is distinct from old.status or new.completion_note is distinct from old.completion_note
    or new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at then
    if old.owner_user_id is distinct from v_actor or old.status not in ('not_started','in_progress','changes_requested')
    or new.status is distinct from 'awaiting_verification'
    then
      if not (old.verifier_user_id=v_actor and old.status='awaiting_verification'
        and new.status in ('verified','changes_requested'))
      then raise exception 'ACTION_OWNER_OR_VERIFIER_REQUIRED'; end if;
    end if;
 end if;
 if new.verifier_user_id is distinct from old.verifier_user_id
    and v_report_owner is distinct from v_actor and not(old.verifier_user_id=v_actor and new.verifier_user_id=v_actor)
 then raise exception 'REPORT_OWNER_REQUIRED_TO_ASSIGN_VERIFIER'; end if;
 if new.description is distinct from old.description or new.due_date is distinct from old.due_date
    or new.priority is distinct from old.priority or new.control_type is distinct from old.control_type
 then raise exception 'ACTIVATED_ACTION_CONTENT_IMMUTABLE'; end if;
 if new.verification_note is distinct from old.verification_note
    or new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at then
    if old.verifier_user_id is distinct from v_actor
    then raise exception 'ASSIGNED_VERIFIER_REQUIRED'; end if;
 end if;
 return new;
end; $$;
create trigger rbh_enforce_action_owner_before_write
before insert or update on public.report_corrective_actions for each row
execute function public.rbh_enforce_corrective_action_owner();
revoke all on function public.rbh_enforce_report_current_owner() from public,anon,authenticated;
revoke all on function public.rbh_enforce_corrective_action_owner() from public,anon,authenticated;
