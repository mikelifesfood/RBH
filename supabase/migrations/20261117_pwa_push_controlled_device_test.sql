-- RBH staff-initiated push test. Safe with global delivery OFF.
-- Atomic 2-minute rate limit on each caller-owned active device.
alter table public.user_push_subscriptions add column if not exists last_test_at timestamptz;

create or replace function public.teamworkt_push_claim_test(
  p_subscription_id uuid, p_user_id uuid, p_session_id uuid
)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare result_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  update public.user_push_subscriptions s
     set last_test_at=now(),updated_at=now()
    where s.id=p_subscription_id
      and s.user_id=p_user_id
      and s.auth_session_id=p_session_id
      and s.disabled_at is null
      and (s.last_test_at is null or s.last_test_at <= now()-interval '2 minutes')
    returning s.id into result_id;
  return result_id is not null;
end;
$$;
revoke all on function public.teamworkt_push_claim_test(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.teamworkt_push_claim_test(uuid,uuid,uuid) to service_role;
