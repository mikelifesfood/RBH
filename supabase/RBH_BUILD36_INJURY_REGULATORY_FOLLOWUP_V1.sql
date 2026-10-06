-- RBH Safety Build 36 - Injury regulatory follow-up and notification tracking
-- Run ONCE in Supabase SQL Editor BEFORE deploying Build 36 dashboard.html.

begin;

alter table public.reports
  add column if not exists calosha_notified_at timestamptz,
  add column if not exists calosha_notified_by text;

comment on column public.reports.calosha_notified_at is
  'Timestamp recorded by an authorized RBH user after the employer has actually notified Cal/OSHA outside this application. This application does not transmit the report.';
comment on column public.reports.calosha_notified_by is
  'Email of the authenticated dashboard user who last recorded or corrected the Cal/OSHA notification timestamp.';

create or replace function public.rbh_update_injury_regulatory_followup(
  p_report_id uuid,
  p_screening_status text,
  p_awareness_at timestamptz default null,
  p_notified boolean default false,
  p_notified_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_org uuid;
  v_email text;
  v_report public.reports%rowtype;
  v_awareness timestamptz;
  v_notified_at timestamptz;
  v_notified_by text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.app_role, p.organization_id, coalesce(nullif(p.email,''), auth.jwt()->>'email')
    into v_role, v_org, v_email
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.is_active,true);

  if not found or v_role not in ('admin','safety_manager') then
    raise exception 'ADMIN_OR_SAFETY_MANAGER_REQUIRED';
  end if;

  select * into v_report
  from public.reports r
  where r.id = p_report_id
    and (v_org is null or r.organization_id = v_org)
  for update;

  if not found then
    raise exception 'REPORT_NOT_FOUND_OR_NOT_AUTHORIZED';
  end if;
  if not coalesce(v_report.involves_injury,false) then
    raise exception 'INJURY_REPORT_REQUIRED';
  end if;
  if p_screening_status not in ('pending','yes','no') then
    raise exception 'INVALID_SCREENING_STATUS';
  end if;

  v_awareness := p_awareness_at;
  if p_screening_status in ('pending','yes') and v_awareness is null then
    raise exception 'AWARENESS_TIME_REQUIRED';
  end if;
  if v_awareness is not null and v_awareness > now() + interval '5 minutes' then
    raise exception 'AWARENESS_TIME_IN_FUTURE';
  end if;
  -- If a later determination becomes No, preserve the previously recorded awareness
  -- time instead of erasing historical regulatory context.
  if p_screening_status = 'no' and v_awareness is null then
    v_awareness := v_report.calosha_awareness_at;
  end if;

  v_notified_at := v_report.calosha_notified_at;
  v_notified_by := v_report.calosha_notified_by;
  if coalesce(p_notified,false) then
    v_notified_at := coalesce(p_notified_at, v_report.calosha_notified_at, now());
    if v_notified_at > now() + interval '5 minutes' then
      raise exception 'NOTIFICATION_TIME_IN_FUTURE';
    end if;
    if v_awareness is not null and v_notified_at < v_awareness then
      raise exception 'NOTIFICATION_BEFORE_AWARENESS';
    end if;
    v_notified_by := coalesce(v_email, auth.jwt()->>'email', v_report.calosha_notified_by);
  end if;
  -- Once a notification has been recorded, leaving the box unchecked later does
  -- not erase it. Corrections are made by saving a corrected notification time.

  update public.reports
     set calosha_screening_status = p_screening_status,
         calosha_awareness_at = v_awareness,
         calosha_notified_at = v_notified_at,
         calosha_notified_by = v_notified_by
   where id = p_report_id;

  return jsonb_build_object(
    'calosha_screening_status', p_screening_status,
    'calosha_awareness_at', v_awareness,
    'calosha_notified_at', v_notified_at,
    'calosha_notified_by', v_notified_by
  );
end;
$$;

revoke all on function public.rbh_update_injury_regulatory_followup(uuid,text,timestamptz,boolean,timestamptz) from public, anon;
grant execute on function public.rbh_update_injury_regulatory_followup(uuid,text,timestamptz,boolean,timestamptz) to authenticated;

commit;

-- Validation
select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='reports' and column_name='calosha_notified_at') as calosha_notified_at_column,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='reports' and column_name='calosha_notified_by') as calosha_notified_by_column,
  to_regprocedure('public.rbh_update_injury_regulatory_followup(uuid,text,timestamp with time zone,boolean,timestamp with time zone)') is not null as followup_rpc_exists;
