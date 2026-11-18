-- STAGED: dedicated ownership email retry queue, independent of paused Weekly Safety Pulse.
-- The existing notification table is the durable source; log event_key is idempotent.
-- Older report/action assignments are not replayed by this scheduler.
create or replace function public.rbh_retry_ownership_emails()
returns integer language plpgsql security definer
set search_path='pg_catalog','public','vault','net' as $$
declare v_secret text;v_row record;v_count integer:=0;
begin
 select decrypted_secret into v_secret
 from vault.decrypted_secrets where name='rbh_notify_report_webhook_next' limit 1;
 if v_secret is null or length(v_secret)<32 then
   raise exception 'OWNERSHIP_EMAIL_SECRET_MISSING';
 end if;
 for v_row in
   select n.id,n.recipient_user_id,n.notification_type
   from public.report_user_notifications n
   where n.created_at>now()-interval '2 days'
     and n.created_at<now()-interval '2 minutes'
     and n.notification_type in (
       'report_transfer_requested','report_transfer_declined','report_owner_transferred_from',
       'corrective_action_reassigned_from','report_owner_assignment','corrective_action_assignment')
     and (n.notification_type not in ('report_transfer_requested') or n.resolved_at is null)
     and (
       n.notification_type not in ('report_owner_assignment','corrective_action_assignment')
       or (n.notification_type='report_owner_assignment' and exists(
         select 1 from public.rbh_report_transfer_requests t
         where t.report_id=n.report_id and t.to_user_id=n.recipient_user_id
           and t.status='accepted' and abs(extract(epoch from (t.decided_at-n.created_at)))<120))
       or (n.notification_type='corrective_action_assignment' and exists(
         select 1 from public.rbh_corrective_action_reassignments a
         where a.corrective_action_id=n.corrective_action_id and a.new_owner_id=n.recipient_user_id
           and abs(extract(epoch from (a.created_at-n.created_at)))<120))
     )
     and not exists (
       select 1 from public.report_notification_events e
       where e.event_key='ownership-event/'||n.id::text||'/'||n.recipient_user_id::text
         and (e.status='sent' or
            (e.status='sending' and e.updated_at>now()-interval '12 minutes'))
     )
   order by n.created_at asc
   limit 20
 loop
   perform net.http_post(
     url:='https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/notify-ownership',
     headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',v_secret),
     body:=jsonb_build_object('notificationId',v_row.id::text));
   v_count:=v_count+1;
 end loop;
 return v_count;
end; $$;
revoke all on function public.rbh_retry_ownership_emails() from public,anon,authenticated;
-- Activate ONLY as part of the coordinated final release, not during development.
select cron.schedule('rbh-ownership-email-retry','*/5 * * * *',
 'select public.rbh_retry_ownership_emails();');
