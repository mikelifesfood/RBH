-- Applied in RBH Supabase 2026-11-18.
-- Pushes only to current workflow recipient; self-created notifications are not queued.
-- Unassigned new reports retain the shared initial management intake alert.

CREATE OR REPLACE FUNCTION public.rbh_emit_corrective_action_user_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_ref text;
  v_now timestamptz := now();
  v_activation_started boolean := false;
  v_reactivated boolean := false;
  v_owner_changed boolean := false;
  v_verifier_changed boolean := false;
begin
  select coalesce(nullif(btrim(r.ref_no::text), ''), left(r.id::text, 8))
    into v_ref
  from public.reports r
  where r.id = new.report_id;

  if tg_op = 'UPDATE' then
    v_activation_started := old.activated_at is null and new.activated_at is not null;
    v_reactivated := old.activated_at is not null
      and new.activation_reopen_count > old.activation_reopen_count;
    v_owner_changed := new.owner_user_id is distinct from old.owner_user_id;
    v_verifier_changed := new.verifier_user_id is distinct from old.verifier_user_id;

    -- Retirement/reactivation makes all active alerts for this action stale.
    if (old.retired_at is null and new.retired_at is not null) or v_reactivated then
      update public.report_user_notifications
         set resolved_at = coalesce(resolved_at, v_now),
             resolution_reason = coalesce(
               resolution_reason,
               case
                 when old.retired_at is null and new.retired_at is not null
                   then 'corrective_action_retired'
                 else 'corrective_action_reactivated'
               end
             )
       where corrective_action_id = new.id
         and resolved_at is null;
    end if;

    -- Owner assignment lifecycle.
    if v_owner_changed
       or (
         new.status is distinct from old.status
         and new.status in ('awaiting_verification','verified')
       ) then
      update public.report_user_notifications
         set resolved_at = coalesce(resolved_at, v_now),
             resolution_reason = coalesce(
               resolution_reason,
               case
                 when v_owner_changed
                   then 'corrective_action_owner_reassigned'
                 else 'corrective_action_submitted'
               end
             )
       where corrective_action_id = new.id
         and notification_type = 'corrective_action_assignment'
         and resolved_at is null;
    end if;

    -- Leaving changes-requested clears the prior owner alert.
    if old.status = 'changes_requested'
       and new.status is distinct from old.status then
      update public.report_user_notifications
         set resolved_at = coalesce(resolved_at, v_now),
             resolution_reason = coalesce(resolution_reason, 'corrective_action_resubmitted')
       where corrective_action_id = new.id
         and notification_type = 'corrective_action_changes_requested'
         and resolved_at is null;
    end if;

    -- Leaving awaiting-verification or changing the assigned verifier clears
    -- the previous reviewer alert before a new one is created.
    if (old.status = 'awaiting_verification' and new.status is distinct from old.status)
       or (new.status = 'awaiting_verification' and v_verifier_changed) then
      update public.report_user_notifications
         set resolved_at = coalesce(resolved_at, v_now),
             resolution_reason = coalesce(
               resolution_reason,
               case
                 when v_verifier_changed then 'corrective_action_verifier_changed'
                 else 'corrective_action_verification_completed_or_returned'
               end
             )
       where corrective_action_id = new.id
         and notification_type = 'corrective_action_verification_requested'
         and resolved_at is null;
    end if;

    -- Fresh owner assignment alert.
    if new.activated_at is not null
       and new.retired_at is null
       and new.owner_user_id is not null
       and new.status in ('not_started','in_progress','changes_requested')
       and (v_activation_started or v_reactivated or v_owner_changed) then
      insert into public.report_user_notifications (
        organization_id,
        recipient_user_id,
        report_id,
        corrective_action_id,
        notification_type,
        title,
        message
      ) values (
        new.organization_id,
        new.owner_user_id,
        new.report_id,
        new.id,
        'corrective_action_assignment',
        'Corrective action #' || new.action_number::text || ' assigned',
        'You own Corrective Action #' || new.action_number::text ||
          ' for Report #' || coalesce(v_ref, left(new.report_id::text, 8)) || '.'
      );
    end if;

    -- Verification request. If a specific reviewer is assigned, target only that
    -- person; otherwise notify the shared Admin / Safety Manager queue.
    if new.activated_at is not null
       and new.retired_at is null
       and new.status = 'awaiting_verification'
       and (
         new.status is distinct from old.status
         or v_verifier_changed
       ) then

      -- Current report owner is the sole active verifier; do not broadcast
      -- to the entire Admin/Safety Manager role group if no legacy verifier ID.
      insert into public.report_user_notifications (
        organization_id, recipient_user_id, report_id, corrective_action_id,
        notification_type, title, message
      )
      select
        new.organization_id,
        r.report_owner_user_id,
        new.report_id,
        new.id,
        'corrective_action_verification_requested',
        'Verify corrective action #' || new.action_number::text,
        'Corrective Action #' || new.action_number::text ||
          ' for Report #' || coalesce(v_ref, left(new.report_id::text, 8)) ||
          ' is ready for verification.'
      from public.reports r
      where r.id = new.report_id and r.organization_id = new.organization_id
        and r.report_owner_user_id is not null;
    end if;

    -- Changes requested: notify only the owner of this action.
    if new.activated_at is not null
       and new.retired_at is null
       and new.status = 'changes_requested'
       and new.status is distinct from old.status
       and new.owner_user_id is not null then
      insert into public.report_user_notifications (
        organization_id,
        recipient_user_id,
        report_id,
        corrective_action_id,
        notification_type,
        title,
        message
      ) values (
        new.organization_id,
        new.owner_user_id,
        new.report_id,
        new.id,
        'corrective_action_changes_requested',
        'Changes requested for corrective action #' || new.action_number::text,
        'More work or evidence is needed for Corrective Action #' ||
          new.action_number::text || ' on Report #' ||
          coalesce(v_ref, left(new.report_id::text, 8)) || '.'
      );
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.teamworkt_enqueue_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true)
   or not exists(select 1 from public.push_organization_settings
      where organization_id=new.organization_id and enabled=true) then return new; end if;
 if new.notification_type not in (
   'new_report','report_owner_assignment','action_assignment',
   'corrective_action_assignment','corrective_action_verification_requested',
   'corrective_action_changes_requested','report_transfer_requested',
   'report_transfer_declined') then return new; end if;
 -- Self-generated work should stay in My Work without a duplicate push.
 if auth.uid() is not null and auth.uid()=new.recipient_user_id then
   return new;
 end if;
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
end; $function$;
