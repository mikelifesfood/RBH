-- STAGED ONLY, second half of ownership foundation. Requires preceding
-- 20261118_report_ownership_transfers_STAGED_NOT_APPLIED.sql.
-- Existing owner assignments, reports and corrective action data are unchanged.

create or replace function public.rbh_claim_unassigned_report(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_uid uuid:=auth.uid();v_role text;v_org uuid;v_report public.reports%rowtype;
begin
 select app_role,coalesce(current_organization_id,organization_id) into v_role,v_org
 from public.profiles where id=v_uid and is_active is true and access_deleted_at is null;
 if v_role not in ('admin','safety_manager') then raise exception 'MANAGER_REQUIRED'; end if;
 select * into v_report from public.reports where id=p_report_id for update;
 if not found or v_report.organization_id is distinct from v_org then raise exception 'REPORT_NOT_FOUND'; end if;
 if v_report.report_owner_user_id is not null then raise exception 'REPORT_ALREADY_OWNED'; end if;
 if v_report.status in ('closed','no_action','duplicate') then raise exception 'REPORT_RESOLVED'; end if;
 update public.reports set report_owner_user_id=v_uid,
 report_owner_assigned_at=now(),report_owner_assigned_by=v_uid where id=p_report_id;
 return jsonb_build_object('ok',true,'report_id',p_report_id,'owner_id',v_uid);
end; $$;

create or replace function public.rbh_reassign_owned_corrective_action(
 p_action_id uuid,p_new_owner uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_uid uuid:=auth.uid();v_role text;v_org uuid;
 v_action public.report_corrective_actions%rowtype;v_report public.reports%rowtype;
 v_target public.profiles%rowtype;
begin
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;
 select app_role,coalesce(current_organization_id,organization_id) into v_role,v_org
 from public.profiles where id=v_uid and is_active is true and access_deleted_at is null;
 if v_role not in ('admin','safety_manager') then raise exception 'MANAGER_REQUIRED'; end if;
 select * into v_action from public.report_corrective_actions where id=p_action_id for update;
 if not found then raise exception 'CORRECTIVE_ACTION_NOT_FOUND'; end if;
 select * into v_report from public.reports where id=v_action.report_id for update;
 if not found or v_report.organization_id is distinct from v_org
 or v_action.organization_id is distinct from v_org then raise exception 'REPORT_NOT_FOUND'; end if;
 if v_role<>'admin' and v_report.report_owner_user_id is distinct from v_uid
 then raise exception 'REPORT_OWNERSHIP_REQUIRED'; end if;
 if v_report.status in ('closed','no_action','duplicate')
 or v_action.retired_at is not null
 or v_action.workflow_generation is distinct from coalesce(v_report.workflow_restart_count,0)
 then raise exception 'ACTION_NOT_CURRENT'; end if;
 if v_action.status in ('verified','awaiting_verification')
 then raise exception 'ACTION_CANNOT_REASSIGN_WHILE_UNDER_REVIEW'; end if;
 if v_action.owner_user_id is not distinct from p_new_owner then raise exception 'OWNER_UNCHANGED'; end if;
 select * into v_target from public.profiles where id=p_new_owner and is_active is true
 and access_deleted_at is null and app_role in ('admin','safety_manager','supervisor')
 and coalesce(current_organization_id,organization_id)=v_org;
 if not found then raise exception 'INVALID_ACTION_OWNER'; end if;
 perform set_config('rbh.authorized_action_reassignment',v_uid::text,true);
 update public.report_corrective_actions set owner_user_id=p_new_owner,updated_by=v_uid,
 updated_at=now() where id=p_action_id;
 insert into public.rbh_corrective_action_reassignments
 (organization_id,report_id,corrective_action_id,old_owner_id,new_owner_id,actor_id,reason)
 values(v_org,v_report.id,p_action_id,v_action.owner_user_id,p_new_owner,v_uid,btrim(p_reason));
 return jsonb_build_object('ok',true,'report_id',v_report.id,'action_id',p_action_id,
 'old_owner_id',v_action.owner_user_id,'new_owner_id',p_new_owner);
end; $$;

create table if not exists public.rbh_corrective_action_reassignments (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 report_id uuid not null references public.reports(id),
 corrective_action_id uuid not null references public.report_corrective_actions(id),
 old_owner_id uuid,new_owner_id uuid not null,actor_id uuid not null,
 reason text not null,created_at timestamptz not null default now()
);
alter table public.rbh_corrective_action_reassignments enable row level security;
revoke all on public.rbh_corrective_action_reassignments from public,anon,authenticated;
revoke all on function public.rbh_claim_unassigned_report(uuid) from public,anon;
revoke all on function public.rbh_reassign_owned_corrective_action(uuid,uuid,text) from public,anon;
grant execute on function public.rbh_claim_unassigned_report(uuid) to authenticated;
grant execute on function public.rbh_reassign_owned_corrective_action(uuid,uuid,text) to authenticated;
