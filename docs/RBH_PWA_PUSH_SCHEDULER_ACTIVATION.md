# RBH Safety automatic PWA push notifications — secure activation

**RBH Supabase project:** `owhkxguiavgxzwvbxevj`  
**Status:** Scheduler function staged; no cron job, and both delivery switches OFF. Self-tests continue working.

## What the RBH administrator must configure

1. Open [RBH Supabase API Keys](https://supabase.com/dashboard/project/owhkxguiavgxzwvbxevj/settings/api-keys).
2. Under **Publishable and secret API keys**, create a **new Secret key** named exactly `rbh_push_dispatch`. It should begin `sb_secret_`. Do **not** use the publishable key or change existing keys.
3. Copy the new secret key only into Supabase's secure Vault creation form: **Database → Vault → New secret**. Name this Vault secret exactly `rbh_push_dispatch_key`. The value must be the newly generated `sb_secret_` key.
4. **Do not** share the key through chat, GitHub, email, screenshots, or SQL text.
5. Tell the development assistant `RBH push dispatcher key saved to Vault`. The assistant should verify Vault **secret names only**, not read/print the actual secret.

Supabase Edge Function `push-dispatch` is deployed with `verify_jwt=false` intentionally, because modern secret API keys are not JWTs. The function explicitly validates the `apikey` header against the dedicated named secret key injected into Edge Functions via `SUPABASE_SECRET_KEYS`. Missing/incorrect keys return 403 and no queue items are claimed.

The internal database scheduler function `teamworkt_internal.rbh_dispatch_push_due()` reads `rbh_push_dispatch_key` securely from `vault.decrypted_secrets`, sends the key **only in the `apikey` header**, and does nothing while delivery is disabled. Public/authenticated roles cannot invoke it.

## Scope, opt-in, and events

- Staff install/open the RBH dashboard, go to **My Profile → Security → Enable push notifications**, approve OS permission, and subscribe independently on each device.
- **All RBH staff can opt in**, but notifications are delivered only when RBH creates an in-app notification for the user and the workflow/role/current assignment authorizes it.
- Six eligible event types: `new_report`, `report_owner_assignment`, `action_assignment`, `corrective_action_assignment`, `corrective_action_verification_requested`, `corrective_action_changes_requested`.
- New-report pushes are restricted to Admin/Safety Manager recipients. Action/owner events are restricted by current role/assignment.
- Generic lock screen message only, no sensitive report details. Email and in-app notifications remain unchanged.
- No retroactive push replay for notifications created while the delivery switch was off.

## Activation checklist for assistant (after secret is saved)

1. Verify `vault.secrets` contains `rbh_push_dispatch_key` (read name only), two gated settings remain OFF, sender Edge Function deployment is healthy and GitHub CI regression passes.
2. Check current notification recipients and devices, RLS and role/tenant isolation. Test a denied unauthenticated request (no secrets printed) and confirm HTTP 403.
3. Run a controlled workflow trigger with RBH opt-in test recipients; inspect outbox and real device delivery before general approval.
4. After explicit RBH go-live approval, set RBH tenant switch ON and global switch ON, then install the minute-based cron job:
   ```sql
   select cron.schedule('rbh-pwa-push-dispatch','* * * * *',
     'select teamworkt_internal.rbh_dispatch_push_due();');
   ```
5. Verify scheduled run result, queue accepted/failed counts, deduplication, 404/410 expired-device handling, and click-through.
6. Test role change, disabled account, multiple devices, notifications opt-out, iPhone Home Screen PWA, report emails, QR/anonymous intake, offline photos. Continue monitoring before wider launch.

## Emergency off / rollback

```sql
update public.push_delivery_settings set enabled=false,updated_at=now() where id=true;
update public.push_organization_settings set enabled=false,updated_at=now()
where organization_id='26a85653-ef58-4bb2-a55d-262c822aba50';
-- If installed: select cron.unschedule('rbh-pwa-push-dispatch');
```

Only push is affected; leave report records, users, current in-app notifications, email and held Safety Pulse digest unchanged.

**No secret values are stored in this file.**
