-- Bind device subscriptions to the validated Supabase authentication session.
-- Guards shared devices after session revocation; no existing subscriptions yet.
alter table public.user_push_subscriptions
  add column if not exists auth_session_id uuid;
create index if not exists user_push_subscriptions_session_idx
  on public.user_push_subscriptions(auth_session_id) where disabled_at is null;

create or replace function public.teamworkt_push_session_active(p_user_id uuid,p_session_id uuid)
returns boolean language sql stable security definer
set search_path = auth, public, pg_temp
as $$
  select case when auth.role() = 'service_role' then exists(
    select 1 from auth.sessions s
    where s.id = p_session_id and s.user_id=p_user_id
      and (s.not_after is null or s.not_after > now())
  ) else false end;
$$;
revoke all on function public.teamworkt_push_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.teamworkt_push_session_active(uuid,uuid) to service_role;
