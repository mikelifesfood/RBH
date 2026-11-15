# TeamWorkt Safety / RBH – Build 7 Security and MVP Handoff
Updated: 2026-11-15

## Scope
RBH Insulation is the pilot implementation for the reusable TeamWorkt Safety product. Preserve existing Admin, Safety Manager, Supervisor, and Read-only role permissions; public reporting; Review → Investigation → Corrective Actions → Close workflow; email/in-app notifications; attachments; and export behavior.

## Build 7: implemented and verified
- Cloudflare Turnstile Managed is integrated with the public form and the Supabase `submit-public-report` Edge Function. Production setting `TURNSTILE_ENFORCE=true` was configured in Supabase.
- Browser intake now uses the protected endpoint without falling back to the older `submit_report` RPC.
- The Edge Function validates challenge token, configured hostname and action, and applies rate-limit checks before server-side submission.
- Existing idempotent client submission keys and offline retry behavior were preserved in code.
- Anonymous AND authenticated EXECUTE privileges for `public.submit_report(jsonb)` were revoked. `service_role` retains access for the protected Edge Function. Verified by database privilege queries and Supabase security advisor after the migrations.
- User acceptance testing passed for online browser reporting, dashboard link → public form → successful submission, Turnstile, and successful report receipt AFTER anonymous RPC lockdown and before authenticated privilege lockdown.
- UI corrections include truthful submitted-versus-saved status and 16px separation between Send Report and Save Draft buttons.

## Remaining validation and security follow-up
- Confirm a fresh online submission after authenticated EXECUTE revocation (privilege query confirms service_role permission, but this specific post-change browser regression has not been user-retested).
- Recheck offline report queue → reconnection → Turnstile verification → server receipt → photo uploads on an actual iPhone after the cutover. A background retry may require an interactive challenge when the app is foregrounded; never represent an unverified pending report as received.
- Existing anonymous attachment uploads and `add_attachment` metadata registration support late/offline photo recovery. The first-24-hour upload path for newly created reports does not require the report-specific upload token. Improve this carefully with compatibility/migration and regression testing before enforcement. Do not break currently pending offline reports.
- Public job-site code lookup is an intentional limited function (`rbh_get_job_site`) and must continue to support job-site QR report preselection.
- Remaining authenticated SECURITY DEFINER warnings need case-by-case policy review, not blanket revocation. Some tables have RLS without browser policies intentionally, as privileged functions handle access.
- Review Supabase backups, installation clone-readiness, secret management, per-customer isolation and ongoing release/version controls before paid-customer launch.

## Supabase leaked-password protection — PLAN LIMITATION AND COMMERCIAL REQUIREMENT
**RBH pilot:** The current Supabase plan is **not eligible for leaked-password protection**, per project owner. The feature is **not enabled in the pilot** because of this plan limitation. Do not label this as a failed security configuration or claim that it is currently active.

**Paid customers:** Leaked-password protection is a **required enablement item** for a future paid-customer deployment on an eligible Supabase plan. Provision/upgrade the customer's independent Supabase project to an eligible paid tier, enable leaked-password protection in Supabase Auth settings, and verify the setting is active as part of deployment acceptance testing. Do not assume upgrading alone automatically enables it. Track plan-dependent costs in the customer onboarding checklist.

The separate company deployment model remains one isolated Supabase project for each paid customer, with customer-specific secrets, data, users, files, and notifications.

## Next MVP product-development workstream
Resume frontend/dashboard usability and useful small-business safety insights without altering working reporting permissions or the four-step workflow. The previously agreed roadmap includes:
1. Dashboard cleanup and a compact Safety Pulse / safety-health overview.
2. Job-site QR-code usability and repeat-hazard visibility.
3. Lessons Learned and reporter follow-up.
4. Supervisor walks and effectiveness checks (later phase).
5. OSHA-specific additions later rather than mixing them into this UI cycle.

For the next dashboard iteration, start by inventorying existing Home and Analytics elements, identify reusable report metrics and non-invasive UI improvements, then implement a tightly scoped change with regression checks. Do not substitute fabricated metrics for real report data.

## Operational considerations
- No new secret values belong in GitHub.
- Build 54 remains reserved for Scheduled Company Records Archive; do not reuse that identifier for Build 7 or dashboard features.
- Keep a changes-only file list for each frontend commit.
