-- STAGED ONLY. Do not apply until the dashboard, notification sender and
-- authorization gates have been updated and tested as a single release.
-- RBH ownership-transfer foundation (2026-11-18).
create table if not exists public.rbh_report_transfer_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 report_id uuid not null references public.reports(id),
 from_user_id uuid not null references auth.users(id),
 to_user_id uuid not null references auth.users(id),
 requested_by uuid not null references auth.users(id),
 status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '7 days'),
 decided_at timestamptz,
 decided_by uuid references auth.users(id),
 constraint different_report_owners check (from_user_id <> to_user_id)
);
create unique index if not exists rbh_one_pending_report_transfer
 on public.rbh_report_transfer_requests(report_id) where status='pending';
create index if not exists rbh_report_transfer_recipient
 on public.rbh_report_transfer_requests(to_user_id,created_at desc);
alter table public.rbh_report_transfer_requests enable row level security;
revoke all on public.rbh_report_transfer_requests from anon,authenticated,public;
-- All user-facing mutations are exposed exclusively through narrowly scoped RPCs.
create or replace function public.rbh_request_report_transfer(p_report_id uuid,p_to_user_id uuid)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth
as $$
declare
 v_actor uuid:=auth.uid(); v_report public.reports%rowtype;
 v_target public.profiles%rowtype; v_actor_role text; v_actor_org uuid;
 v_id uuid;
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
 select app_role,coalesce(current_organization_id,organization_id) into v_actor_role,v_actor_org
 from public.profiles where id=v_actor and is_active is true and access_deleted_at is null;
 if v_actor_role not in ('admin','safety_manager') then raise exception 'MANAGER_REQUIRED'; end if;
 select * into v_report from public.reports where id=p_report_id for update;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 if v_report.organization_id is distinct from v_actor_org then raise exception 'ORGANIZATION_MISMATCH'; end if;
 if v_report.status in ('closed','no_action','duplicate') then raise exception 'REPORT_RESOLVED'; end if;
 if v_report.report_owner_user_id is distinct from v_actor then raise exception 'ONLY_CURRENT_OWNER_CAN_TRANSFER'; end if;
 select * into v_target from public.profiles where id=p_to_user_id and is_active is true
 and access_deleted_at is null and app_role in ('admin','safety_manager')
 and coalesce(current_organization_id,organization_id)=v_report.organization_id;
 if not found then raise exception 'INVALID_RECIPIENT'; end if;
 if p_to_user_id=v_actor then raise exception 'SAME_OWNER'; end if;
 update public.rbh_report_transfer_requests set status='cancelled',decided_at=now(),decided_by=v_actor
 where report_id=p_report_id and status='pending';
 insert into public.rbh_report_transfer_requests(organization_id,report_id,from_user_id,to_user_id,requested_by)
 values(v_report.organization_id,p_report_id,v_actor,p_to_user_id,v_actor) returning id into v_id;
 return jsonb_build_object('ok',true,'transfer_id',v_id,'status','pending');
end; $$;
create or replace function public.rbh_decide_report_transfer(p_transfer_id uuid,p_accept boolean)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth
as $$
declare
 v_actor uuid:=auth.uid(); v_transfer public.rbh_report_transfer_requests%rowtype;
 v_report public.reports%rowtype; v_role text; v_org uuid;
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
 select app_role,coalesce(current_organization_id,organization_id) into v_role,v_org
 from public.profiles where id=v_actor and is_active is true and access_deleted_at is null;
 if v_role not in ('admin','safety_manager') then raise exception 'MANAGER_REQUIRED'; end if;
 select * into v_transfer from public.rbh_report_transfer_requests where id=p_transfer_id for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 if v_transfer.to_user_id is distinct from v_actor or v_transfer.organization_id is distinct from v_org
 then raise exception 'TRANSFER_NOT_ASSIGNED_TO_YOU'; end if;
 if v_transfer.status<>'pending' then raise exception 'TRANSFER_NOT_PENDING'; end if;
 if v_transfer.expires_at<=now() then
   update public.rbh_report_transfer_requests set status='expired',decided_at=now() where id=p_transfer_id;
   return jsonb_build_object('ok',false,'status','expired');
 end if;
 select * into v_report from public.reports where id=v_transfer.report_id for update;
 if v_report.report_owner_user_id is distinct from v_transfer.from_user_id
   or v_report.organization_id is distinct from v_org
   or v_report.status in ('closed','no_action','duplicate')
 then raise exception 'REPORT_OWNERSHIP_CHANGED'; end if;
 if p_accept is true then
   update public.reports set report_owner_user_id=v_actor,
    report_owner_assigned_at=now(),report_owner_assigned_by=v_transfer.from_user_id
   where id=v_transfer.report_id;
 end if;
 update public.rbh_report_transfer_requests set status=case when p_accept then 'accepted' else 'declined' end,
 decided_at=now(),decided_by=v_actor where id=p_transfer_id;
 return jsonb_build_object('ok',true,'status',case when p_accept then 'accepted' else 'declined' end,'report_id',v_transfer.report_id);
end; $$;
create or replace function public.rbh_admin_take_report(p_report_id uuid,p_reason text)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth
as $$
declare
 v_actor uuid:=auth.uid(); v_role text; v_org uuid; v_report public.reports%rowtype;
begin
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'OVERRIDE_REASON_REQUIRED'; end if;
 select app_role,coalesce(current_organization_id,organization_id) into v_role,v_org
 from public.profiles where id=v_actor and is_active is true and access_deleted_at is null;
 if v_role is distinct from 'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 select * into v_report from public.reports where id=p_report_id for update;
 if not found or v_report.organization_id is distinct from v_org then raise exception 'REPORT_NOT_FOUND'; end if;
 if v_report.status in ('closed','no_action','duplicate') then raise exception 'REPORT_RESOLVED'; end if;
 if v_report.report_owner_user_id is distinct from v_actor then
   update public.rbh_report_transfer_requests set status='cancelled',decided_at=now(),decided_by=v_actor
   where report_id=p_report_id and status='pending';
   update public.reports set report_owner_user_id=v_actor,report_owner_assigned_at=now(),
     report_owner_assigned_by=v_actor where id=p_report_id;
   -- Separate durable audit for mandatory override reason; existing report audit also records owner change.
   insert into public.rbh_report_ownership_overrides
      (organization_id,report_id,previous_owner_id,new_owner_id,actor_id,reason)
   values(v_org,p_report_id,v_report.report_owner_user_id,v_actor,v_actor,btrim(p_reason));
 end if;
 return jsonb_build_object('ok',true,'report_id',p_report_id,'owner_id',v_actor);
end; $$;
create table if not exists public.rbh_report_ownership_overrides (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 report_id uuid not null references public.reports(id),
 previous_owner_id uuid,new_owner_id uuid not null,actor_id uuid not null,
 reason text not null, created_at timestamptz not null default now()
);
alter table public.rbh_report_ownership_overrides enable row level security;
revoke all on public.rbh_report_ownership_overrides from anon,authenticated,public;
revoke all on function public.rbh_request_report_transfer(uuid,uuid) from public,anon;
revoke all on function public.rbh_decide_report_transfer(uuid,boolean) from public,anon;
revoke all on function public.rbh_admin_take_report(uuid,text) from public,anon;
grant execute on function public.rbh_request_report_transfer(uuid,uuid) to authenticated;
grant execute on function public.rbh_decide_report_transfer(uuid,boolean) to authenticated;
grant execute on function public.rbh_admin_take_report(uuid,text) to authenticated;
