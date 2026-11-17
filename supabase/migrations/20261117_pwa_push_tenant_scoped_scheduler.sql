-- RBH PWA push: restrict event queuing and dispatch to explicitly enabled organizations.
-- No events are sent by this migration. Global and RBH tenant switches remain OFF.
create table if not exists public.push_organization_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.push_organization_settings enable row level security;
revoke all on public.push_organization_settings from anon, authenticated;
grant all on public.push_organization_settings to service_role;
insert into public.push_organization_settings(organization_id,enabled)
values ('26a85653-ef58-4bb2-a55d-262c822aba50',false)
on conflict (organization_id) do nothing;

create or replace function public.teamworkt_enqueue_push_notification()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
 if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true)
 or not exists(select 1 from public.push_organization_settings
               where organization_id=new.organization_id and enabled=true) then
   return new;
 end if;
 if new.notification_type not in (
   'new_report','report_owner_assignment','action_assignment',
   'corrective_action_assignment','corrective_action_verification_requested',
   'corrective_action_changes_requested'
 ) then return new; end if;
 insert into public.push_delivery_outbox(notification_id,subscription_id,organization_id)
 select new.id,s.id,new.organization_id from public.user_push_subscriptions s
 where s.user_id=new.recipient_user_id and s.organization_id=new.organization_id
 and s.disabled_at is null
 on conflict (notification_id,subscription_id) do nothing;
 return new;
end;
$$;
revoke all on function public.teamworkt_enqueue_push_notification() from public,anon,authenticated;

-- Run only as an internal scheduled database job; read the key from Vault at execution.
create or replace function teamworkt_internal.rbh_dispatch_push_due()
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare backend_key text;
begin
 if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true)
 or not exists(select 1 from public.push_organization_settings where enabled=true)
 then return; end if;
 select decrypted_secret into backend_key
 from vault.decrypted_secrets where name='rbh_push_dispatch_key'
 order by created_at desc limit 1;
 if backend_key is null or backend_key not like 'sb_secret_%' then
   raise warning 'RBH push scheduler has no configured backend key';
   return;
 end if;
 perform net.http_post(
  url:='https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/push-dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',backend_key),
  body:='{}'::jsonb,timeout_milliseconds:=10000
 );
end;
$$;
revoke all on function teamworkt_internal.rbh_dispatch_push_due() from public,anon,authenticated;
-- Scheduler is not registered until the dedicated key and controlled workflow test pass.
