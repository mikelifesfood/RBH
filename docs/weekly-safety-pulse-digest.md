## Scheduler readiness build — November 16, 2026

**Status: infrastructure and deterministic checks complete; live scheduled delivery NOT authorized.**

### Implemented
- Enabled `pg_cron` extension alongside already installed `pg_net`; confirmed **zero** `rbh-weekly-safety-pulse` scheduled jobs.
- Deployed protected Edge Function `safety-pulse-weekly-digest` **version 2**.
- Extracted `core.ts` with deterministic, IANA-aware Monday 08:00-08:14 logic and eligibility checks. Invalid timezone configurations fail closed.
- Hardened company scanning with stable pagination; active-company validation; scoped and paginated recipient queries; and a fresh check of company opt-in/release and each recipient's role, active status, email, and effective organization before an attempted send.
- Added 15-second Brevo timeout, with claimed-but-ambiguous attempts **never automatically retried**.
- Confirmed unique index on `(organization_id, week_start, recipient_user_id)` in `safety_pulse_digest_deliveries`.
- Confirmed `authenticated` and `anon` cannot insert delivery records; authenticated role cannot invoke the privileged digest snapshot RPC; RLS is on for settings, test-deliveries and weekly-deliveries tables.
- Created `tests/digest-scheduler-readiness.test.mjs`; ran locally with Node 22 using `--experimental-strip-types`: **7 tests passed, 0 failed** (winter/summer, spring/fall DST transitions, US/UK timezones, window boundaries, roles, inactive/deleted/blank-email recipients, cross-organization effective membership).
- Created unexecuted `docs/weekly-digest-scheduler-activation.md` playbook with Vault secret setup, the scheduler SQL for future approval, RBH-only release gate, and emergency rollback.

### Verified live state
- RBH `enabled = false`, `delivery_ready = false`.
- No digest scheduler job exists.
- No weekly digest delivery audit rows exist.
- No scheduler dispatch credential was provisioned as part of this build.
- Existing controlled Admin test-email acceptance remains passed.

### Remaining release gates
1. Production-equivalent **two-tenant integration test**, including RBH vs a separate disposable company and inactive/role-changed recipients. Pure eligibility tests passed but this is NOT a live cross-tenant end-to-end test.
2. Controlled **scheduler invocation** integration test (including duplicate calls, failed/ambiguous Brevo responses, and released/disabled transitions), using test recipients only; test without contacting any real weekly recipients.
3. Privileged secret provisioning in Supabase Edge Function Secrets and Vault. No secrets in the repository.
4. Review Supabase Security Advisor separately for unrelated pre-existing findings. Two digest audit tables intentionally have RLS enabled without read policies, because only service-role access is needed.
5. Obtain explicit RBH approval for scheduled delivery before creating a cron job or switching `delivery_ready` true. The Admin opt-in toggle alone never activates production weekly email.

## Controlled email acceptance — PASSED (November 16, 2026)
- RBH Admin completed all five Admin configuration/preview checks: Off default, preview counts, save On persistence, save Off persistence.
- One controlled test email was requested at 2026-11-16 19:49:21 UTC (2:49 p.m. America/New_York).
- Supabase Edge Function `safety-pulse-digest-test` returned HTTP 200; the test-delivery audit insert succeeded (HTTP 201) and update succeeded (HTTP 204).
- `safety_pulse_digest_test_deliveries` audit ID 1 reports `sent`, has a Brevo SMTP message identifier, and no error. The user confirmed receipt and approved the metrics, layout, and dashboard link.
- No direct Brevo provider-dashboard event logs were available through the installed connector. The SMTP provider acceptance is established by the message ID, successful function response, and inbox confirmation; it is not an independently reviewed Brevo activity-log entry.
- Production weekly digest preference remained Off and `delivery_ready=false`. No weekly digest delivery records exist.
- **Closed:** controlled digest test email.
- **Open:** secure scheduler configuration, production release gate approval, idempotency/DST/tenant regression checks, and scheduled-cycle acceptance.
- Do not activate scheduler or `delivery_ready` until these remaining gates are reviewed.

# Weekly Safety Pulse digest — RBH pilot handoff

## Approved defaults (November 16, 2026)
- Opt-in, off by default; company Admin may save the preference.
- Monday 8:00 a.m. in the company's configured IANA time zone.
- Eligible recipients: active Admins and Safety Managers with email addresses.
- No incident descriptions, people involved, attachments, names of reporters, or individual case details in email.
- The digest is separate from the existing new-report email grouped/individual/off option.

## Delivered in this build
- Admin > Admin Settings > Weekly Safety Pulse digest: opt-in checkbox, Save, Preview counts.
- Database settings: `public.safety_pulse_digest_settings`. Read restricted to company Admins and Safety Managers; changes through Admin-only RPC.
- Database preview RPC: `rbh_preview_safety_pulse_digest()` computes previous local Monday-Sunday totals (new/closed reports and completed actions) plus current overdue and pending-verification action counts, scoped to the company and current workflow generation.
- Server-only snapshot RPC: `rbh_digest_service_snapshot(uuid,timestamptz)`, executable only by `service_role`, with opt-in and delivery-release checks.
- Delivery audit: `public.safety_pulse_digest_deliveries` with a unique company/week/recipient key.
- Edge Function `safety-pulse-weekly-digest`, source `supabase/functions/safety-pulse-weekly-digest/index.ts`. It requires `DIGEST_DISPATCH_SECRET`, sends individually using the existing Brevo account only during the local Monday 08:00-08:14 window, and records sends and failures. It never retries ambiguous sends automatically.

## Current delivery status — disabled
- `delivery_ready` defaults to false and cannot be changed by ordinary dashboard users.
- No `DIGEST_DISPATCH_SECRET` has been set as part of this build.
- No scheduler has been installed or enabled as part of this build.
- This Edge Function has `verify_jwt=false` because it is a server-to-server scheduler target; it **requires** the secret header `x-digest-dispatch-key` before doing any work and returns 503 when missing.
- There have been no digest delivery attempts.
- Existing report and assignment emails are unchanged.

## Controlled Admin email test (November 16, 2026)
- The Admin > Notifications > Weekly Safety Pulse digest card includes **Send test email to my account**. Requires an explicit confirmation.
- The new `safety-pulse-digest-test` Supabase Edge Function has JWT validation enabled and independently verifies the caller with Supabase Auth, active Admin role, and that their RBH profile email matches their Auth email.
- The function rejects client-supplied recipient addresses and always sends **only** to the signed-in Admin email. No test sends automatically.
- Preview totals come from `rbh_preview_safety_pulse_digest()` under the caller's own auth context.
- Sends through existing Brevo credentials, with the subject prefixed `[TEST]`; no incident descriptions or personal data in the email.
- The service records each request in `safety_pulse_digest_test_deliveries`, with a 10-minute per-account duplicate guard and provider result status. The test table is not exposed to anonymous or authenticated data API roles.
- This test does **not** change `enabled`, `delivery_ready`, or install a scheduler; the production weekly worker remains disabled.
- At deployment, no test requests or weekly delivery attempts had been recorded.

### Browser acceptance test
1. Refresh Admin > Notifications. Confirm the opt-in remains Off.
2. Click **Send test email to my account** and approve the browser confirmation displaying your signed-in email address.
3. Confirm the UI states **Brevo accepted**; then check the inbox (and spam) for `[TEST] Weekly Safety Pulse`.
4. Confirm the subject, sender, layout, five metrics, period, and dashboard link. Email contains no incident names, descriptions, or attachments.
5. Check the test-delivery audit and provider message status; a successful provider acceptance is not proof of inbox delivery.
6. Verify no company weekly-send flag changed. Repeat during the 10-minute window to confirm a cooldown response. Do not conduct an actual second send.
7. After passing, the next release gate is scheduled-delivery authorization and end-to-end role/tenant checks.

## Before release
1. As RBH Admin, open the dashboard Admin tab and confirm the digest is Off, the preview renders, and the numbers match the existing data. Verify roles other than Admin cannot change the preference.
2. Test opt-in On / Off persistence; leave Off after testing unless explicitly approving delivery.
3. Test preview counts and boundary dates around midnight, DST transitions, year-end, closed reports, multiple corrective actions, and reopened workflows.
4. Test receiving a branded digest with a **separate controlled test tenant and recipients**; inspect Brevo logs and `safety_pulse_digest_deliveries`. Do not use real incident detail in test messages.
5. Validate failed-provider cases, duplicate invocations, inactive users, unverified data, and tenant isolation.
6. Configure the IANA time zone during each new tenant's onboarding; the RBH pilot currently defaults to America/New_York.
7. Configure `DIGEST_DISPATCH_SECRET` as a Supabase Edge Function secret and in a secure scheduler or Vault. Schedule every 15 minutes (UTC) so the worker can decide company-local Monday 08:00. Do not expose the secret in GitHub or the browser.
8. Only after the acceptance checks pass, explicitly set `delivery_ready=true` for the approved tenant via a privileged release procedure, and verify delivery on the next scheduled run.
9. Review batch size / runtime and pagination before multi-tenant scale. The current implementation is suitable for pilot validation, not a claim of full production scale.

## Rollback
- Turn off company opt-in via Admin immediately (or set `delivery_ready=false` through the privileged release procedure).
- Disable the scheduler; do not delete existing delivery audit records.
- The feature's new tables and functions are additive. The existing transactional email workflow is independent.
