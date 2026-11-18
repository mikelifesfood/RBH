-- Staged transfer inbox RPC; purposefully no direct user grants on private transfer ledger.
create or replace function public.rbh_my_pending_report_transfers()
returns table(
 transfer_id uuid,report_id uuid,report_number bigint,
 from_user_id uuid,from_owner_name text,expires_at timestamptz,requested_at timestamptz
) language plpgsql security definer set search_path='pg_catalog','public','auth'
as $$
declare v_uid uuid:=auth.uid();v_org uuid;v_role text;
begin
 select p.app_role,coalesce(p.current_organization_id,p.organization_id)
 into v_role,v_org from public.profiles p
 where p.id=v_uid and p.is_active is true and p.access_deleted_at is null;
 if v_role not in ('admin','safety_manager') then raise exception 'MANAGER_REQUIRED'; end if;
 return query
 select t.id,r.id,r.ref_no,t.from_user_id,coalesce(p.full_name,p.email,'Report Owner')::text,
 t.expires_at,t.created_at
 from public.rbh_report_transfer_requests t
 join public.reports r on r.id=t.report_id
 left join public.profiles p on p.id=t.from_user_id
 where t.to_user_id=v_uid and t.organization_id=v_org
 and r.organization_id=v_org and r.report_owner_user_id=t.from_user_id
 and t.status='pending' and t.expires_at>now()
 order by t.created_at desc
 limit 100;
end; $$;
revoke all on function public.rbh_my_pending_report_transfers() from public,anon;
grant execute on function public.rbh_my_pending_report_transfers() to authenticated;
