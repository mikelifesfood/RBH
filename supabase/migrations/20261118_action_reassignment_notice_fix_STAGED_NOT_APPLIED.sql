-- STAGED: reassigned action in changes_requested must notify its new owner.
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

      if new.verifier_user_id is not null then
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
          new.verifier_user_id,
          new.report_id,
          new.id,
          'corrective_action_verification_requested',
          'Verify corrective action #' || new.action_number::text,
          'Corrective Action #' || new.action_number::text ||
            ' for Report #' || coalesce(v_ref, left(new.report_id::text, 8)) ||
            ' is ready for verification.'
        );
      else
        insert into public.report_user_notifications (
          organization_id,
          recipient_user_id,
          report_id,
          corrective_action_id,
          notification_type,
          title,
          message
        )
        select
          new.organization_id,
          p.id,
          new.report_id,
          new.id,
          'corrective_action_verification_requested',
          'Verify corrective action #' || new.action_number::text,
          'Corrective Action #' || new.action_number::text ||
            ' for Report #' || coalesce(v_ref, left(new.report_id::text, 8)) ||
            ' is ready for verification.'
        from public.profiles p
        where coalesce(p.current_organization_id, p.organization_id) = new.organization_id
          and coalesce(p.is_active, true) = true
          and p.app_role in ('admin','safety_manager');
      end if;
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
