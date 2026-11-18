-- RBH assignment alerts: keep in-app audit/work records, but do not enqueue push
-- for a recipient who assigned the item to themself.
-- Leaves all review/change-request and new-report push events unchanged.
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

  if new.notification_type in (
    'report_owner_assignment','action_assignment','corrective_action_assignment'
  ) then
    -- Direct authenticated session writes have a trustworthy JWT actor.
    if auth.uid() is not null and auth.uid()=new.recipient_user_id then return new; end if;
    -- Report Owner assignments record the assigning manager on the report.
    if new.notification_type='report_owner_assignment' and exists(
      select 1 from public.reports r where r.id=new.report_id
        and r.organization_id=new.organization_id
        and r.report_owner_assigned_by=new.recipient_user_id
    ) then return new; end if;
    -- Child-action activation/reassignment writes record their actor on the action.
    if new.notification_type='corrective_action_assignment' and exists(
      select 1 from public.report_corrective_actions a
      where a.id=new.corrective_action_id and a.report_id=new.report_id
        and a.organization_id=new.organization_id
        and a.owner_user_id=new.recipient_user_id
        and coalesce(a.updated_by,a.activated_by)=new.recipient_user_id
    ) then return new; end if;
  end if;

  insert into public.push_delivery_outbox(notification_id,subscription_id,organization_id)
  select new.id,s.id,new.organization_id
  from public.user_push_subscriptions s
  where s.user_id=new.recipient_user_id and s.organization_id=new.organization_id
    and s.disabled_at is null
  on conflict (notification_id,subscription_id) do nothing;
  return new;
end;
$$;
revoke all on function public.teamworkt_enqueue_push_notification() from public,anon,authenticated;
