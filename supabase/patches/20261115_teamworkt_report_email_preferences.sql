-- TeamWorkt Build 2: company-scoped initial intake email preferences.
-- Default preserves deployed grouped new-report delivery.
create table if not exists public.report_email_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  delivery_mode text not null default 'grouped' check (delivery_mode in ('grouped','individual','off')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.report_email_settings enable row level security;
revoke all on table public.report_email_settings from public, anon, authenticated;
grant select, insert, update on table public.report_email_settings to service_role;

create or replace function public.rbh_get_report_email_mode()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_mode text;
begin
  select p.organization_id into v_org
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active is true
     and p.app_role = 'admin'
     and p.access_deleted_at is null;
  if v_org is null then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select s.delivery_mode into v_mode
    from public.report_email_settings s
   where s.organization_id = v_org;
  return coalesce(v_mode,'grouped');
end;
$$;

create or replace function public.rbh_set_report_email_mode(p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_mode is null or p_mode not in ('grouped','individual','off') then
    raise exception 'INVALID_DELIVERY_MODE' using errcode = '22023';
  end if;
  select p.organization_id into v_org
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active is true
     and p.app_role = 'admin'
     and p.access_deleted_at is null;
  if v_org is null then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  insert into public.report_email_settings (organization_id,delivery_mode,updated_at,updated_by)
  values (v_org,p_mode,now(),(select auth.uid()))
  on conflict (organization_id)
  do update set delivery_mode=excluded.delivery_mode,
                updated_at=excluded.updated_at,
                updated_by=excluded.updated_by;
  return p_mode;
end;
$$;
revoke all on function public.rbh_get_report_email_mode() from public, anon;
revoke all on function public.rbh_set_report_email_mode(text) from public, anon;
grant execute on function public.rbh_get_report_email_mode() to authenticated;
grant execute on function public.rbh_set_report_email_mode(text) to authenticated;
