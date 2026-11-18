-- RBH production: permit the assigned corrective-action owner to submit work
-- while the completion RPC automatically chooses the current report owner as verifier.
-- The guard requires an actual owner-completed transition with verification
-- fields cleared; direct verifier reassignment and nonowner completion remain denied.

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
    and not(old.owner_user_id=v_actor
      and old.status in ('not_started','in_progress','changes_requested')
      and new.status='awaiting_verification'
      and new.verifier_user_id is not distinct from v_report_owner
      and new.completed_by=v_actor and new.completed_at is not null
      and new.verification_note is null and new.verified_by is null and new.verified_at is null)
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
