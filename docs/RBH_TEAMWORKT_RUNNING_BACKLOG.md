# RBH / TeamWorkt Safety — Running MVP Backlog

_Last reviewed: November 17, 2026. Living working list. Change statuses as tasks are completed. Do not reopen passed tests without evidence of a regression._

## Status definitions
- **P0 · RBH go-live gate**: Required to sign off RBH's pilot.
- **P0 · commercial gate**: Required before onboarding paying, separate-company customers.
- **P1 · improvement**: Useful, not essential to finish the tested RBH MVP.
- **HOLD**: Explicitly deferred; do not activate or build further without an updated decision.
- **PASSED**: Previously accepted by user.

## P0 — Remaining RBH go-live acceptance and support

- [ ] **PWA push notifications — implementation substantially complete; RBH acceptance still P0 (Nov 17)**: Implemented signed-in staff profile opt-in, private per-device subscriptions, session/logout revocation, VAPID-gated sender, event-specific recipient rechecks, role/tenant filtering, safe notification tap/click, invalid-device handling and private deduplicated outbox. Applied additive DB migrations; deployed `push-subscriptions` and `push-dispatch` Edge Functions; CI worker/privacy regression PASSED. **Delivery switch is OFF, no VAPID credentials or push schedule enabled, and no real browser/device sends performed.** Outstanding: securely configure VAPID secrets and Vault dispatch credential; controlled endpoint/tenant/live-device tests including iPhone Home Screen PWA and desktop; verify six events, multi-device, revocation and queue retries; final pilot sign-off. Docs: `docs/RBH_PWA_PUSH_NOTIFICATIONS_HANDOFF.md`, `docs/RBH_PWA_PUSH_SCHEDULER_ACTIVATION.md`, `docs/RBH_PWA_PUSH_IMPLEMENTATION_STATUS_2026-11-17.md`.
- [ ] **Final expired-session browser regression**: Admin role management must display sign-in guidance after expired 401; code correction committed, actual browser regression not signed off.
- [ ] **Final release walk-through / smoke test**: On current deployed build, verify Admin, Safety Manager, Supervisor and Read Only navigation, reports, My Work, corrective actions, closing, attachments, user management, notifications, and mobile/PWA at least once as a consolidated release acceptance (not a new feature build).
- [ ] **Document rollback, recovery and operational monitoring**: Maintain a release checklist, incident response contacts, backup/restore test, Supabase/Brevo/Cloudflare service dependencies, and sign-off for RBH handover.
- [ ] **Review Supabase security-advisor findings before launch**: In particular, externally callable security-definer functions including `add_attachment`, `rbh_get_job_site` and `teamworkt_allow_anonymous_report_upload`. Distinguish intentional public reporting access from unintended permissions; do not blanket-revoke working anonymous intake.
- [ ] **Review old QA 401 incident**: Prior assignment/email 401 appears resolved in subsequent tests; only reopen for an actual recurrence. Keep a note in regression records.

## P0 — Before selling TeamWorkt Safety to other companies

- [ ] **Reuse PWA push foundation for subsequent TeamWorkt tenants**: After RBH pilot passes, repeat the device subscription, isolation, push-rate limiting and delivery tests with a second company. See the detailed RBH handoff.
- [ ] **Private reusable TeamWorkt master**: Separate customer-independent source, branded defaults, and RBH-specific settings from the deployable baseline.
- [ ] **Repeatable tenant onboarding/provisioning**: Clean migrations, seeds/defaults, secrets, email sender setup, job sites, Admin invitations, domain/hosting workflow, and reproducible setup instructions.
- [ ] **Tenant/data isolation**: Cross-company tests for RLS, Supabase privileged functions, roles, report attachments, signed URLs, service endpoints, email recipients, and administrative context.
- [ ] **Backups / restoration / migration rollback**: Validate recovery and failover, not just that backups are configured.
- [ ] **Customer release process**: Versioning, staging/production gates, regression checklist, deployment, rollback, logs/alerts, access review.
- [ ] **Security upgrade gates**: Enable leaked-password protection when on an eligible Supabase paid plan; revisit rate limits, service secrets, audit logging, attachment access and penetration/security review.
- [ ] **Commercial/legal readiness**: Customer terms, privacy/data-retention terms, data roles, support process, customer onboarding guides, account deletion/export, billing and subscription handling. Price target previously discussed: **$149.99/month, unlimited users** for small employers; customer-specific additions priced separately.

## P1 — Usability/analytics additions to evaluate after core launch

- [ ] **Repeat-hazard / job-site trends**: Group repeat report types and sites, include practical drill-downs in Safety Pulse/Analytics; avoid unsupported risk scores.
- [ ] **Analytics polish**: Better site comparisons, filtering, historical trends, and responsive presentation where end-user value justifies it.
- [ ] **Customer-facing Admin polish**: Review organization-specific labels/defaults, onboarding copy, settings discoverability, and mobile layout based on real customer feedback.
- [ ] **Optional push-preference enhancements after initial PWA push MVP**: Per-event user choices, quiet hours, digest-style grouping and advanced settings after basic delivery is stable.
- [ ] **Notifications/admin controls future review**: Review business demand for additional notification granularity rather than alter the tested initial-report grouped/individual/off modes or assignment emails without a requirement.

## HOLD — Do not activate/build now

- [ ] **Weekly Safety Pulse email digest — HOLD**. Admin opt-in, data preview and controlled Brevo test email passed; worker v2, `pg_cron` and `pg_net` prepared. RBH `enabled=false`, `delivery_ready=false`; no cron job. Before release: two-tenant integration, duplicate/failure scheduled-invocation tests, secrets in Edge Functions + Vault, scheduler installation, explicit RBH-only production approval. See `docs/weekly-safety-pulse-digest.md` and `docs/weekly-digest-scheduler-activation.md`. This is separate from the **completed** Home Safety Pulse overview.
- [ ] **Reporter lookup / status portal**: Deferred future feature; evaluate safety, privacy and public-token controls.
- [ ] **Lessons Learned module**: Deferred.
- [ ] **Corrective-action effectiveness / follow-up checks**: Deferred.
- [ ] **Supervisor five-minute safety walks**: Deferred.
- [ ] **Advanced OSHA automation / enterprise analytics / AI capabilities**: Out of current small-business MVP scope.

## PASSED — No rebuild required unless regression found

- [x] Reports and My Work ownership, report owner assignment, investigation handoff, corrective actions (multiple actions / verification / send-back / add before close), closing and receipts.
- [x] Due-date display fix; one-click Continue to Close acceptance; corrective-action evidence upload (six browser checks).
- [x] Admin/Safety Manager/Supervisor/Read Only role-permission test sequence and controls.
- [x] Initial report, report owner, corrective-action assignment and verification/completion notification emails.
- [x] Initial-report grouped/individual/off settings; existing user-approved tests.
- [x] Safety Pulse **dashboard** overview, grouped report filtering and drill-down.
- [x] Job-site QR posters, public intake, Cloudflare Turnstile/rate limits, offline photos/queue and PWA Back to Dashboard; browser/device acceptance reported passed.
- [x] Admin page tabs and presence-notification styling implemented; final overall smoke test covers these.
- [x] Weekly digest Admin settings and preview (five acceptance checks) and **controlled test email** (inbox, metrics, layout and link), but **scheduled digest is held**.

## Recommended next action
Complete the remaining **P0 push device/security acceptance and credentials**, then the **expired-session browser regression** and then a concise full-release smoke test. Separately, plan the **private TeamWorkt master / tenant isolation** as the first commercial build.

This list is the source of truth for future backlog updates; preserve completed items and mark changes with date and rationale.
