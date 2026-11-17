-- RBH PWA push event queue and atomic claims. Push remains OFF until explicitly enabled.
-- The trigger produces no rows while public.push_delivery_settings.enabled = false.
create or replace function public.teamworkt_enqueue_push_notification()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true) then
    return new;
  end if;
  if new.notification_type not in (
    'new_report','report_owner_assignment','action_assignment',
    'corrective_action_assignment','corrective_action_verification_requested',
    'corrective_action_changes_requested'
  ) then return new; end if;
  insert into public.push_delivery_outbox(notification_id,subscription_id,organization_id)
  select new.id, s.id, new.organization_id
  from public.user_push_subscriptions s
  where s.user_id=new.recipient_user_id
    and s.organization_id=new.organization_id and s.disabled_at is null
  on conflict (notification_id,subscription_id) do nothing;
  return new;
end;
$$;
revoke all on function public.teamworkt_enqueue_push_notification() from public, anon, authenticated;
drop trigger if exists teamworkt_push_notification_enqueue on public.report_user_notifications;
create trigger teamworkt_push_notification_enqueue
  after insert on public.report_user_notifications
  for each row execute function public.teamworkt_enqueue_push_notification();

create or replace function public.teamworkt_push_claim(p_limit integer default 10)
returns setof public.push_delivery_outbox
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true) then
    return;
  end if;
  return query
  with candidate as (
    select o.id from public.push_delivery_outbox o
    where o.status in ('pending','retry') and o.next_attempt_at<=now()
      and o.attempts<5
    order by o.created_at, o.id limit least(greatest(p_limit,1),20)
    for update skip locked
  )
  update public.push_delivery_outbox o
     set status='claimed',claimed_at=now(),attempts=o.attempts+1,updated_at=now()
   where o.id in(select candidate.id from candidate)
   returning o.*;
end;
$$;
revoke all on function public.teamworkt_push_claim(integer) from public, anon, authenticated;
grant execute on function public.teamworkt_push_claim(integer) to service_role;

-- No scheduled job, no digest activation, and no changes to existing notification rows.
