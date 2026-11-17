# RBH PWA Web Push — current implementation and pilot gate
**Date:** November 17, 2026
**Repository:** `mikelifesfood/RBH` — commits directly to `main`.
**Supabase project:** `owhkxguiavgxzwvbxevj`.

## Completed and deployed
- Additive production database tables: `user_push_subscriptions`, `push_delivery_outbox`, `push_delivery_settings`; all new tables have RLS and no direct anon/authenticated grants. No existing reports, profiles, email notifications or attachments modified.
- Database trigger enqueues only six supported `report_user_notifications` event types, only while global dispatch setting enabled; currently `enabled=false`. Server-only claim function uses `FOR UPDATE SKIP LOCKED` and deduplicated event/device keys.
- `push-subscriptions` Edge Function deployed with JWT verification: authenticates live user, checks active profile/current organization, validates approved HTTPS provider endpoint and key formats, enforces per-user device limit, binds subscription to Supabase auth session, supports status/register/disable/disable_session/disable_all; no direct client reads of endpoint/key table.
- `push-dispatch` Edge Function deployed with JWT verification + service-role-only authorization: VAPID/env prerequisite, disabled switch, queue claims, active account/org/session/role/current report/action rechecks, generic payload, 404/410 expiry, 429/5xx retries, safe outcome audit. No secret or private endpoint values in logs.
- Staff `dashboard.html` My Profile > Security has explicit per-device push controls; browser `push-client.js` checks installed iOS/permissions, uses authenticated `supabase.functions.invoke`, revokes session devices on signout, keeps email/bell fallback.
- `sw.js` displays only generic notification body and focuses or opens same-origin `dashboard.html`; notification tap routes to the notification center by default; where the event message is delivered to an already running dashboard, existing authorized notification handling opens its report, never trusting report details in the payload or URL.
- Existing public PWA, its separate manifest, anonymous intake, narrow offline cache and email/digest behavior intentionally preserved.
- GitHub Actions `RBH PWA Push regression` passes after click routing changes, including syntax, worker malicious-payload/click safety and source guard assertions.

- **Controlled self-test added after VAPID setup:** `push-test-device` Edge Function deployed; My Profile > Security offers **Send test to this device** only after authenticated device registration. The test requires current live user/org/session/device match and an atomic two-minute per-device limit, and does **not** enable global dispatch or create/modify any incident. The provider accepts or rejects the encrypted push, while the service worker displays only generic text. **Mac/Chrome controlled self-test passed on November 17, 2026**; phone close/reopen notification tap passed; production workflow events remain untested.

## Verified on Supabase
- `push_delivery_settings.enabled = false`; `user_push_subscriptions` active count **2**; `push_delivery_outbox` count **0** (global workflow sending remains off).
- Neither anon nor authenticated can read or insert the new tables.
- Only service_role can execute private queue claim and auth-session-check functions; unauthorized session check returns false.
- Claim function returns 0 while delivery is disabled.
- No `rbh-pwa-push-dispatch` schedule exists.

## Controlled Mac/Chrome self-test — PASSED (November 17, 2026)
- User confirmed receipt of the system notification: **“You have a safety item requiring attention. Sign in to review.”**
- RBH Supabase shows one active device registration linked to an authenticated session; `last_test_at` and `last_success_at` populated, `last_failure_at` null, `failure_count=0`.
- `function_edge_logs` show one HTTP 200 response for `push-test-device` and two HTTP 429 responses confirming the two-minute test rate limit. `push-subscriptions` requests succeeded (HTTP 200/204).
- Global push delivery remained disabled; no outbox rows or scheduled company-wide delivery were created.
- This confirms Chrome/Mac **receipt** and encrypted push-provider acceptance; **phone notification click-through tested separately; offline delivery, all six workflow events, and other roles remain unverified**.

## Phone PWA notification click-through — PASSED (user confirmation)
- User sent a push to their phone, closed the RBH app, tapped the system notification, and confirmed **the app opened directly to the notification center**.
- Database verification after the test: **2 active device subscriptions, 2 with recorded successful sends, 0 with recorded failures**; company-wide delivery switch remains OFF, outbox 0, push scheduler 0.
- This verifies phone app reopening and notification-center fallback for the generic device self-test, **not** exact incident navigation or a workflow-generated event. Do not infer platform/iOS version from user description alone.

## Not yet verified / do NOT mark passed
- User reports adding VAPID secrets in RBH Supabase; the Mac/Chrome test confirms a working end-to-end Web Push transaction. Private values were not read or exposed. The phone receipt/open test was user-confirmed separately; additional devices and platforms remain unverified.
- Edge Function *deployment success* is not proof that Web Push provider exchange, service-worker receipt, or all user-role flows work end-to-end.
- Full authenticated endpoint registration/disable contract tests, different tenant/user tests, six event-specific real sends, repeat/late triggers and 404/410 cleanup must run with controlled accounts.
- Cold-start notification click always opens signed-in notification center; exact-item routing is best effort via postMessage and must be tested on iOS. Do not claim exact navigation reliably passes until verified.
- Phone PWA system notification click/open to notification center **PASSED (user acceptance)**. The phone operating system and Home Screen installation method were not independently identified; platform-specific iOS coverage cannot be asserted yet. Offline delivery, permission denied, logout/shared device and assignment-change tests remain.
- Existing P0 Admin expired-session 401 regression, security-definer advisor review, final RBH smoke test, backup/monitoring and explicit go/no-go remain outstanding.

## Required actions before controlled live testing
1. **Completed by user; tested successfully on Chrome/Mac:** Generate VAPID P-256 pair securely. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` under RBH Supabase Edge Function Secrets. Never put private key in GitHub, app HTML, screenshots or chat.
2. **Chrome/Mac receipt PASSED:** device registration and test provider acceptance confirmed. Phone PWA notification click/open to notification center also PASSED on a separate test. Confirm iPhone installed Home Screen context before marking iOS-specific acceptance.
3. Configure RBH Vault dispatch service credential `rbh_push_dispatch_role_key` and stage the `pg_cron` / `pg_net` job as documented in `docs/RBH_PWA_PUSH_SCHEDULER_ACTIVATION.md`. Do not activate until device, role and rate/duplicate checks pass.
4. With a controlled test event, temporarily enable only approved RBH test recipients, send, inspect accepted/failed audit, and turn off as needed.
5. Run the full matrix above, regress existing workflows, and sign off pilot go/no-go before enabling recurring dispatch.

## Rollback / off switch
`UPDATE public.push_delivery_settings SET enabled=false,updated_at=now() WHERE id=true;`
If scheduler later installed, unschedule `rbh-pwa-push-dispatch`.
Do **not** revert or delete existing report, email, attachment or offline PWA functionality as a push rollback.
