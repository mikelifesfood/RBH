-- RBH Safety - Build 52
-- Profile Security Guard / Admin Edge Function Compatibility
-- 2026-10-06
--
-- Purpose:
--   Allow trusted Supabase service_role operations (such as admin-manage-user)
--   to update profiles.app_role / profiles.is_active while preserving the
--   existing Admin-only guard for normal authenticated browser users.
--
-- Why:
--   admin-manage-user validates the signed-in caller as an Admin, then performs
--   the approved profile update through a Supabase service-role client.
--   The existing trigger subsequently calls rbh_current_app_role(), but a
--   service-role PostgREST request has no normal end-user auth.uid(), so the
--   trigger raises ADMIN_REQUIRED.
--
-- Security:
--   This does NOT allow ordinary authenticated users to bypass the trigger.
--   Only service_role receives the bypass. Possession of the service-role key
--   already represents trusted backend access and must never be exposed to a
--   browser/client.

begin;

create or replace function public.rbh_guard_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE'
     and (
       new.app_role is distinct from old.app_role
       or new.is_active is distinct from old.is_active
     ) then

    -- Trusted backend operations, including admin-manage-user, are allowed.
    -- Browser users never receive the service_role JWT/key.
    if coalesce(auth.role(), '') = 'service_role' then
      return new;
    end if;

    -- Preserve the original protection for normal authenticated users.
    if public.rbh_current_app_role() <> 'admin' then
      raise exception 'ADMIN_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

commit;

-- Validation: both values should return true.
select
  exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
      and t.tgname = 'rbh_guard_profile_security_fields_trg'
      and p.proname = 'rbh_guard_profile_security_fields'
  ) as profile_security_trigger_ready,
  position(
    'service_role'
    in pg_get_functiondef('public.rbh_guard_profile_security_fields()'::regprocedure)
  ) > 0 as service_role_backend_bypass_ready;
