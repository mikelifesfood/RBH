# RBH Weekly Safety Pulse — secure scheduler activation (NOT ENABLED)
#
# OPERATOR-ONLY RELEASE PLAYBOOK. DO NOT RUN THIS FILE DURING READINESS TESTING.
# pg_cron and pg_net are installed. No job was created by the readiness build.
# The weekly worker is deployed but fail-closed without a dispatch secret.

## Gate 0 — prerequisites before doing anything that can send email

1. Document the RBH approval to enable production weekly sends.
2. Confirm the controlled test message was delivered and the seven scheduling
   and recipient regression suites passed; manually inspect a second tenant
   test before selling multi-tenant subscriptions.
3. Confirm the local timezone in safety_pulse_digest_settings is valid and
   matches RBH's desired location. Current default: America/New_York.
4. Confirm Brevo sender and RBH-specific dashboard link from Supabase secrets.
5. Confirm the destination roles and that opted-in status is deliberately On.
6. Check the 10-minute window, recipient roles, and previous weekly audit status.
7. Take a copy of current configurations and have a rollback procedure ready.

## Gate 1 — manually provision a long random shared secret, without committing it
- Create DIGEST_DISPATCH_SECRET in Supabase Edge Function Secrets.
- Create the exact same secret in Supabase Vault named
  rbh_weekly_digest_dispatch_key. Create separately using Vault dashboard/
  supported UI, never commit the value or paste it into a GitHub file.
- Confirm the Vault entry exists without logging decrypted value.
- Do not reuse BREVO_API_KEY or the Supabase service role key as the scheduler secret.
- Never add a secret to the public dashboard, client HTML, or SQL migration.

## Gate 2 — stage the scheduler once release has been approved

The following is an *example*, not an executed job. Review it, then run
manually in the RBH Supabase SQL Editor AFTER Gate 1 is complete.

```sql
-- This SQL has NOT been run. It becomes active immediately if executed.
select cron.schedule(
  'rbh-weekly-safety-pulse',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/safety-pulse-weekly-digest',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-digest-dispatch-key',
        (select decrypted_secret from vault.decrypted_secrets
          where name = 'rbh_weekly_digest_dispatch_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);
```

- pg_cron runs in the database timezone (typically UTC); this polling interval
  covers the first 15 minutes after 8 AM in each tenant's local time.
- The worker itself enforces Monday 08:00-08:14 in the IANA timezone.
- Unique index (organization_id,week_start,recipient_user_id) prevents duplicate
  weekly deliveries, including simultaneous/manual duplicate scheduler invocations.
- Provider timeouts are not automatically retried; a lost acknowledgment may
  represent a completed send. Review failures before any manual intervention.
- If no company is opted in AND delivery_ready is false, the worker sends nothing.

## Gate 3 — release RBH only

Once the secure scheduler is staged and tests pass, explicitly approve RBH
delivery. In a supervised SQL session, do the following, substituting only the
reviewed RBH org identity; do not run this in preparation-only mode.

```sql
-- NOT EXECUTED — releasing a company makes live sends eligible.
update public.safety_pulse_digest_settings
set delivery_ready = true, updated_at=now()
where organization_id = (
  select id from public.organizations where slug = 'rbh-insulation'
);
```

Opt-in remains a separate Admin setting. Both flags must be true.
The first live report email will occur only during the next Monday 8 AM local
window with the scheduler enabled.

## Verification and rollback

```sql
-- Read-only health queries safe to run now.
select jobid,jobname,schedule,active
from cron.job where jobname = 'rbh-weekly-safety-pulse';

select organization_id,enabled,delivery_ready,timezone
from public.safety_pulse_digest_settings;

select organization_id,week_start,recipient_user_id,status,
       provider_message_id,created_at,sent_at
from public.safety_pulse_digest_deliveries
order by created_at desc limit 25;
```

Emergency stop (use only if live scheduling has been explicitly enabled):

```sql
-- For RBH only, disable live sends without removing history.
update public.safety_pulse_digest_settings set delivery_ready=false
where organization_id = (
 select id from public.organizations where slug='rbh-insulation'
);
-- Then stop the scheduler:
select cron.unschedule('rbh-weekly-safety-pulse');
```

Important: a request already accepted by Brevo cannot be retracted. The
worker rechecks company opt-in and user eligibility immediately before send.
Cron enabling, Vault provisioning, and release flags are not part of the
current readiness build.
