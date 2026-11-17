# RBH PWA push secure scheduler — activation guide (NOT ACTIVE)
**November 17, 2026 — RBH project `owhkxguiavgxzwvbxevj`.**

## Current status
- Device API and sender Edge Functions deployed. Schema and queue trigger installed, with `push_delivery_settings.enabled=false`.
- No VAPID secrets configured by this code; do not add private keys to GitHub or browser bundles.
- No scheduled push dispatcher and no live notifications. Weekly Safety Pulse digest remains separate and ON HOLD.

## Secrets / delivery prerequisites (pilot only)
1. Generate a Web Push P-256 VAPID key pair locally using a trusted tool; set only `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:admin@your-domain`) in the **RBH Supabase Edge Function secrets**. Never commit or paste private values in this repository.
2. The `VAPID_PUBLIC_KEY` is safe to return to authenticated staff clients; private key and contact stay in Supabase Secrets.
3. Supabase Vault: add the existing RBH **service-role JWT** as a new Vault secret named `rbh_push_dispatch_role_key`, with restricted admin access. This is needed only if enabling the production `pg_cron` → `pg_net` scheduler. Never put the value into migration SQL.
4. Confirm `pg_cron` and `pg_net` available and confirm outbound Apple/Google/Mozilla push gateway compatibility.
5. Audit credentials and ensure secrets do not appear in function logs, raw SQL results or dashboard output.

## Required pre-activation tests
- Server 401/403 and cross-account/tenant/device ownership tests
- iPhone installed Home Screen PWA + desktop opt-in and system notification click tests
- All six notification types, denied permission, role demotion, reassignments, deleted/deactivated accounts, sign-out and invalid 410 endpoint
- Duplicate queue trigger, claims and retry behavior; no sensitive lock screen copy
- Existing anonymous intake, offline photos, QR, report email and dashboard regression
- Admin 401 expired session and privileged-function security review from RBH backlog
- Rollback process and RBH pilot go/no-go

## Optional activation SQL — do not execute until final approval

```sql
-- Create once after Vault secret and Edge Secrets are verified.
create or replace function teamworkt_internal.rbh_dispatch_push_due()
returns void language plpgsql security definer
set search_path=teamworkt_internal, public, vault, extensions, pg_temp
as $$
declare role_token text;
begin
  if not exists(select 1 from public.push_delivery_settings where id=true and enabled=true) then
    return;
  end if;
  select decrypted_secret into role_token
    from vault.decrypted_secrets
    where name='rbh_push_dispatch_role_key'
    order by created_at desc limit 1;
  if role_token is null then raise warning 'Push scheduler secret missing'; return; end if;
  perform net.http_post(
    url:='https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/push-dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||role_token,'apikey',role_token),
    body:='{}'::jsonb,
    timeout_milliseconds:=10000
  );
end;
$$;
revoke all on function teamworkt_internal.rbh_dispatch_push_due() from public,anon,authenticated;
-- Activate once RBH approval and device acceptance have passed:
-- update public.push_delivery_settings set enabled=true,updated_at=now() where id=true;
-- select cron.schedule('rbh-pwa-push-dispatch','* * * * *','select teamworkt_internal.rbh_dispatch_push_due();');
```

## Rollback
1. Immediately `update public.push_delivery_settings set enabled=false,updated_at=now() where id=true;`
2. `select cron.unschedule('rbh-pwa-push-dispatch');` if scheduled.
3. Leave SW/offline public shell and existing email/in-app notifications intact.
4. Investigate `push_delivery_outbox` state without printing endpoints, p256dh, auth or key material.
5. Do not silently re-send uncertain claimed/accepted events.

**This guide is configuration/readiness only. No scheduler is installed by this file.**
