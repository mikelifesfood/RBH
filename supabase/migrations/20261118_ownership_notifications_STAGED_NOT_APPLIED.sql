-- STAGED ONLY: server-generated ownership notifications and safe web-push enqueue.
-- Requires both ownership migrations and matching Edge Function / push-dispatch / SW deployment.
-- Never attach client-supplied notification titles, secrets, or incident details to push payloads.

create or replace function public.rbh_emit_transfer_request_notifications()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' and new.status='pending' then
   insert into public.report_user_notifications
      (organization_id,recipient_user_id,report_id,notification_type,title,message)
   values(new.organization_id,new.to_user_id,new.report_id,'report_transfer_requested',
      'Report ownership transfer requested','A report owner has offered to transfer a report to you. Accept or decline in RBH Safety.');
 elsif tg_op='UPDATE' and new.status is distinct from old.status then
   if new.status='declined' then
     insert into public.report_user_notifications
       (organization_id,recipient_user_id,report_id,notification_type,title,message)
     values(new.organization_id,new.from_user_id,new.report_id,'report_transfer_declined',
       'Report transfer declined','Your proposed report ownership transfer was declined. You remain the Report Owner.');
   elsif new.status='accepted' then
     insert into public.report_user_notifications
       (organization_id,recipient_user_id,report_id,notification_type,title,message)
     values(new.organization_id,new.from_user_id,new.report_id,'report_owner_transferred_from',
       'Report ownership transferred','Your report ownership transfer was accepted. The report is now read only for you.');
   end if;
   if old.status='pending' then
     update public.report_user_notifications
       set resolved_at=coalesce(resolved_at,now()),
           resolution_reason='transfer_request_'||new.status
     where report_id=new.report_id and recipient_user_id=new.to_user_id
       and notification_type='report_transfer_requested' and resolved_at is null;
   end if;
 end if;
 return new;
end; $$;
create trigger rbh_ownership_offer_notify
after insert or update on public.rbh_report_transfer_requests
for each row execute function public.rbh_emit_transfer_request_notifications();

create or replace function public.rbh_emit_admin_takeover_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.previous_owner_id is not null and new.previous_owner_id is distinct from new.new_owner_id then
   insert into public.report_user_notifications
     (organization_id,recipient_user_id,report_id,notification_type,title,message)
   values(new.organization_id,new.previous_owner_id,new.report_id,'report_owner_transferred_from',
      'Report ownership transferred','An Administrator has reassigned this report. It is now read only for you.');
 end if;
 return new;
end; $$;
create trigger rbh_admin_takeover_notify after insert on public.rbh_report_ownership_overrides
for each row execute function public.rbh_emit_admin_takeover_notification();

create or replace function public.rbh_emit_action_reassignment_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.old_owner_id is not null and new.old_owner_id is distinct from new.new_owner_id then
   insert into public.report_user_notifications
     (organization_id,recipient_user_id,report_id,corrective_action_id,notification_type,title,message)
   values(new.organization_id,new.old_owner_id,new.report_id,new.corrective_action_id,
      'corrective_action_reassigned_from','Corrective action reassigned',
      'A corrective action you previously owned has been reassigned. It is now read only for you.');
 end if;
 return new;
end; $$;
create trigger rbh_action_reassignment_notify after insert on public.rbh_corrective_action_reassignments
for each row execute function public.rbh_emit_action_reassignment_notification();

-- Preserve existing checks for current assignees and opted-in subscriptions.
create or replace function public.teamworkt_enqueue_push_notification()
returns trigger language plpgsql security definer
set search_path='public','pg_temp' as $$
begin
 if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true)
   or not exists(select 1 from public.push_organization_settings
      where organization_id=new.organization_id and enabled=true) then return new; end if;
 if new.notification_type not in (
   'new_report','report_owner_assignment','action_assignment',
   'corrective_action_assignment','corrective_action_verification_requested',
   'corrective_action_changes_requested','report_transfer_requested',
   'report_transfer_declined','report_owner_transferred_from',
   'corrective_action_reassigned_from') then return new; end if;
 if new.notification_type in ('report_owner_assignment','action_assignment','corrective_action_assignment') then
   if auth.uid() is not null and auth.uid()=new.recipient_user_id
      and not (
        (new.notification_type='report_owner_assignment'
          and coalesce(current_setting('rbh.accepted_report_transfer',true),'')=auth.uid()::text)
        or
        (new.notification_type='corrective_action_assignment'
          and coalesce(current_setting('rbh.authorized_action_reassignment',true),'')=auth.uid()::text)
      )
   then return new; end if;
   if new.notification_type='report_owner_assignment' and exists(
      select 1 from public.reports r where r.id=new.report_id
      and r.organization_id=new.organization_id
      and r.report_owner_assigned_by=new.recipient_user_id) then return new; end if;
   if new.notification_type='corrective_action_assignment'
      and coalesce(current_setting('rbh.authorized_action_reassignment',true),'')<>coalesce(auth.uid()::text,'')
      and exists(
      select 1 from public.report_corrective_actions a
      where a.id=new.corrective_action_id and a.report_id=new.report_id
      and a.organization_id=new.organization_id
      and a.owner_user_id=new.recipient_user_id
      and coalesce(a.updated_by,a.activated_by)=new.recipient_user_id) then return new; end if;
 end if;
 insert into public.push_delivery_outbox(notification_id,subscription_id,organization_id)
 select new.id,s.id,new.organization_id from public.user_push_subscriptions s
 where s.user_id=new.recipient_user_id and s.organization_id=new.organization_id
 and s.disabled_at is null
 on conflict(notification_id,subscription_id) do nothing;
 return new;
end; $$;
revoke all on function public.rbh_emit_transfer_request_notifications() from public,anon,authenticated;
revoke all on function public.rbh_emit_admin_takeover_notification() from public,anon,authenticated;
revoke all on function public.rbh_emit_action_reassignment_notification() from public,anon,authenticated;

-- Ownership notification events are delivered through the existing project webhook secret
-- into a dedicated isolated Edge Function, not via user-controlled requests.
create or replace function public.rbh_enqueue_ownership_email_webhook()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public','vault','net' as $$
declare v_secret text;
begin
 if new.notification_type not in (
 'report_transfer_requested','report_transfer_declined','report_owner_transferred_from',
 'report_owner_assignment','corrective_action_reassigned_from','corrective_action_assignment'
 ) then return new; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets
 where name='rbh_notify_report_webhook_next' limit 1;
 if v_secret is null or length(v_secret)<32 then
   raise exception 'OWNERSHIP_EMAIL_WEBHOOK_SECRET_UNAVAILABLE';
 end if;
 perform net.http_post(
 url:='https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/notify-ownership',
 headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',v_secret),
 body:=jsonb_build_object('notificationId',new.id::text));
 return new;
end; $$;
create trigger rbh_ownership_email_webhook after insert on public.report_user_notifications
for each row execute function public.rbh_enqueue_ownership_email_webhook();
revoke all on function public.rbh_enqueue_ownership_email_webhook() from public,anon,authenticated;
