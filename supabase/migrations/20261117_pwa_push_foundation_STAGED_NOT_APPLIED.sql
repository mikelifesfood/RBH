-- RBH PWA push foundation. STAGED ONLY: do not execute until Edge Function and tests are ready.
-- Additive schema; existing notification, report, profile and email rows are untouched.
create table if not exists public.user_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  endpoint_sha256 text not null unique,
  p256dh text not null,
  auth_secret text not null,
  enabled_at timestamptz not null default now(),
  disabled_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint ~ '^https://[^[:space:]]+$'),
  constraint push_endpoint_hash check (endpoint_sha256 ~ '^[a-f0-9]{64}$'),
  constraint push_key_lengths check (length(p256dh) between 50 and 150 and length(auth_secret) between 12 and 100)
);
create index if not exists user_push_subscriptions_recipient_idx
  on public.user_push_subscriptions(organization_id,user_id) where disabled_at is null;
alter table public.user_push_subscriptions enable row level security;
-- Intentionally NO client policies. Subscription endpoint and keys are secrets.
-- Only the authenticated Edge Function via service role may manage these records.
revoke all on public.user_push_subscriptions from anon, authenticated;
grant all on public.user_push_subscriptions to service_role;

create table if not exists public.push_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.report_user_notifications(id) on delete cascade,
  subscription_id uuid not null references public.user_push_subscriptions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','claimed','accepted','retry','expired','cancelled','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_http_status integer,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,subscription_id)
);
create index if not exists push_delivery_due_idx
  on public.push_delivery_outbox(next_attempt_at) where status in ('pending','retry');
alter table public.push_delivery_outbox enable row level security;
revoke all on public.push_delivery_outbox from anon, authenticated;
grant all on public.push_delivery_outbox to service_role;

create table if not exists public.push_delivery_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.push_delivery_settings enable row level security;
revoke all on public.push_delivery_settings from anon, authenticated;
grant all on public.push_delivery_settings to service_role;
insert into public.push_delivery_settings(id,enabled) values (true,false)
on conflict (id) do nothing;
-- No sending trigger, scheduled job, or live push activation in this migration.
