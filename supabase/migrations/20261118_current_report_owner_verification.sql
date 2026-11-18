-- Applied to RBH Supabase 2026-11-18, two production migrations.
-- Dynamic verifier = current report owner. Pending child verifier is synchronized
-- on ownership transfer, while completed audit history remains untouched.

CREATE OR REPLACE FUNCTION public.rbh_enforce_corrective_action_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
      if not (v_report_owner=v_actor and old.status='awaiting_verification'
        and new.status in ('verified','changes_requested'))
      then raise exception 'ACTION_OWNER_OR_VERIFIER_REQUIRED'; end if;
    end if;
 end if;
 if new.verifier_user_id is distinct from old.verifier_user_id
    and v_report_owner is distinct from v_actor
    and not(old.owner_user_id=v_actor and old.status='changes_requested'
      and new.status='awaiting_verification' and new.verifier_user_id is not distinct from v_report_owner)
 then raise exception 'REPORT_OWNER_REQUIRED_TO_ASSIGN_VERIFIER'; end if;
 if new.description is distinct from old.description or new.due_date is distinct from old.due_date
    or new.priority is distinct from old.priority or new.control_type is distinct from old.control_type
 then raise exception 'ACTIVATED_ACTION_CONTENT_IMMUTABLE'; end if;
 if new.verification_note is distinct from old.verification_note
    or new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at then
    if v_report_owner is distinct from v_actor
      and not(old.owner_user_id=v_actor and old.status='changes_requested'
        and new.status='awaiting_verification' and new.verification_note is null
        and new.verified_by is null and new.verified_at is null)
    then raise exception 'ASSIGNED_VERIFIER_REQUIRED'; end if;
 end if;
 return new;
end; $function$;

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

  if v_report.report_owner_user_id is distinct from v_uid then
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

  if p_verifier_user_id is distinct from v_report.report_owner_user_id then
    raise exception 'CURRENT_REPORT_OWNER_IS_VERIFIER';
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

    -- The current report owner is always the verifier when work is submitted.
    verifier_user_id = v_report.report_owner_user_id,
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

CREATE OR REPLACE FUNCTION public.rbh_sync_current_owner_to_pending_verifiers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
begin
  if new.report_owner_user_id is not distinct from old.report_owner_user_id then return new; end if;
  update public.report_corrective_actions a
    set verifier_user_id=new.report_owner_user_id,
        updated_at=now(),
        updated_by=coalesce(auth.uid(),new.report_owner_user_id)
  where a.report_id=new.id
    and a.workflow_generation=coalesce(new.workflow_restart_count,0)
    and a.activation_reopen_count=coalesce(new.reopen_count,0)
    and a.retired_at is null and a.activated_at is not null
    and a.status='awaiting_verification'
    and a.verifier_user_id is distinct from new.report_owner_user_id;
  return new;
end;
$function$;

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
  if v_report.report_owner_user_id is distinct from v_uid then
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

-- Synchronization trigger installed by the live migration:
DROP TRIGGER IF EXISTS rbh_owner_follows_pending_verification_trg ON public.reports;
CREATE TRIGGER rbh_owner_follows_pending_verification_trg
AFTER UPDATE OF report_owner_user_id ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.rbh_sync_current_owner_to_pending_verifiers();

UPDATE public.report_corrective_actions a
SET verifier_user_id=r.report_owner_user_id, updated_at=now()
FROM public.reports r
WHERE a.report_id=r.id AND a.status='awaiting_verification'
  AND a.retired_at IS NULL AND a.activated_at IS NOT NULL
  AND a.workflow_generation=coalesce(r.workflow_restart_count,0)
  AND a.activation_reopen_count=coalesce(r.reopen_count,0)
  AND a.verifier_user_id IS DISTINCT FROM r.report_owner_user_id
  AND r.report_owner_user_id IS NOT NULL;
