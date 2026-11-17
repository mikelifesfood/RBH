# RBH / TeamWorkt Safety — PWA Push Notifications Handoff
**Prepared:** November 17, 2026  
**Next project:** PWA Web Push for signed-in staff  
**First pilot:** RBH Insulation  
**Target:** User intends to put RBH into the hands of the first staff test users during the week of November 16–20, 2026, **subject to acceptance and security gates**  
**Status:** Planning/handoff only — no push implementation or deployment is authorized by this document

## 1. Objective and launch position

Deliver useful, secure **background push notifications for installed PWA staff users**, complementing existing email and in-app notification alerts. RBH is the first real-user pilot. Preserve all working safety-report submission, corrective-action, role, email, PWA offline, and QR-code workflows.

**Goal:** After PWA push passes device, permission, role, and end-to-end tests, run a short RBH launch smoke test and invite the pilot test users. Do not confuse successful push implementation with full security/operations sign-off. Resolve or explicitly accept remaining release blockers in the running backlog before calling the pilot ready.

**Non-goals for this sprint:** scheduled Safety Pulse email digest (ON HOLD), SMS, native App Store builds, AI features, broad customer billing/provisioning, public anonymous-report status notifications, and advanced per-event quiet-hour rules.

## 2. Verified current baseline (GitHub and Supabase)

GitHub repository: `mikelifesfood/RBH`, branch `main`. Supabase RBH project: `owhkxguiavgxzwvbxevj`. **Do not alter other Supabase projects or unrelated GitHub repositories.**

- `dashboard.html` has a signed-in notification bell/center, reads `public.report_user_notifications`, performs foreground polling around every 30 seconds and listens to Supabase realtime notification changes. These are not system-level push alerts when the app is closed.
- `sw.js` is the active shared-scope service worker for public form and dashboard. It handles installation, offline shell caching, and network-first navigation. **No push or notificationclick event handlers exist.** Keep its narrow cache policy: never cache signed-in dashboard HTML, Supabase/auth responses, attachments, or incident details.
- `pwa-client.js` registers `sw.js` with the application scope and already distinguishes staff dashboard install prompts from the public form.
- **Two manifests already exist:** `dashboard.webmanifest` starts at `./dashboard.html` with ID `./dashboard.html`; the separate `manifest.webmanifest` is for the anonymous reporting PWA. Preserve this split and avoid silently replacing the staff manifest.
- `public.report_user_notifications` stores `id`, `organization_id`, `recipient_user_id`, `report_id`, `corrective_action_id`, `notification_type`, `title`, `message`, `created_at`, and acknowledgment/resolution timestamps.
- **Existing event types verified from Supabase:** `new_report`, `report_owner_assignment`, `action_assignment`, `corrective_action_assignment`, `corrective_action_verification_requested`, `corrective_action_changes_requested`.
- No `public` push-subscription table exists, and dashboard/service-worker code has no Push API subscription, system notification permission request, or background push support.
- Existing successful tests include the full report workflow, roles, corrective-action evidence upload, email notifications, offline forms/QR protection, and PWA navigation. Do not rebuild working pieces without a demonstrated regression.

## 3. MVP notification matrix

| Existing internal event | Intended push audience | Priority | Expected click action |
| --- | --- | --- | --- |
| `new_report` | Only the recipient(s) already authorized by the in-app event; typically active Admin/Safety Manager | P0 | Open staff dashboard / relevant report after sign-in |
| `report_owner_assignment` | Assigned report owner | P0 | Open assigned report |
| `action_assignment` | Assigned user represented by that event | P0 | Open relevant My Work / report |
| `corrective_action_assignment` | Corrective-action owner | P0 | Open exact corrective action |
| `corrective_action_verification_requested` | Assigned verifier / authorized manager as recorded | P0 | Open verification work |
| `corrective_action_changes_requested` | Corrective-action owner needing revisions | P0 | Open action |
| Future informational events | Scope after pilot | HOLD | No implementation yet |

**Recipient principle:** A push can be generated *only* from a legitimate, recipient-specific authorized in-app event (or equivalent audited server-side source); never infer recipients from a title or trust a browser-supplied `user_id`. Verify active status, effective organization, and current event visibility before dispatch. If a user's access changes, do not disclose old event text on their lock screen.

Suggested privacy-safe copy: “RBH Safety — You have a safety item requiring attention. Open the dashboard to review.” An event-specific title such as “Corrective action assigned” is acceptable; exclude names, job site, injury details, report narrative, sensitive identifiers, and attachments.

## 4. Implementation workstreams — recommended build order

### A. Foundation and keys
1. Decide the push delivery implementation: standard Web Push/VAPID with a compatible library and server-side Supabase Edge Function; verify Deno/browser compatibility and outbound Apple/Google/Mozilla endpoints.
2. Generate a VAPID key pair securely. Store **private key and sender contact only in Supabase Secrets**; expose only the public application server key to authenticated subscription clients. Never commit credentials.
3. Build `public.user_push_subscriptions` or equivalent with `organization_id`, `user_id`, `endpoint`, `p256dh`, `auth`, per-device metadata (non-identifying), `enabled_at`, `last_success_at`, `last_failure_at`, `disabled_at`, audit timestamps. Encrypt/severely restrict endpoint and cryptographic material; do not display raw endpoints in Admin views or logs.
4. Strong RLS: user can manage **only own** device subscriptions within active company; server-side delivery can read only via constrained trusted service path. Prevent user/tenant reassignment and device hijacking via upsert.
5. Add a private send audit/outbox with unique keys e.g. `(notification_id,subscription_id)`, retry policy, bounded attempts, status, and cleanup of 404/410 expired subscriptions. Avoid inconsistent partial deliveries; inspect failures without exposing endpoint secrets.

### B. Staff PWA opt-in UX
1. Add an explicit **Enable push notifications** control in the signed-in dashboard/profile or notification settings. **Do not prompt on page load, public reporting form, or before login.**
2. Detect browser/OS support, secure context, permission already denied, existing subscription, standalone display status on iOS, and manifest/service-worker registration readiness. Display a concise explanation of benefits and limitations.
3. Permission request must be triggered by the user's click/tap. Subscribe with `userVisibleOnly:true` and the public VAPID key; persist the returned subscription only for the authenticated user.
4. Provide current device status and a **Disable notifications on this device** option, with meaningful guidance for denied permission via browser/OS settings.
5. Handle log out, account deactivation, tenant switching, device re-subscription and browser reinstall/endpoint rotation. Define whether subscriptions follow user/device or are removed on logout; **never send work from a previous user's account to a shared device**.
6. Keep existing email and bell notifications working even if device push is unsupported or refused.

### C. Service worker and click routing
1. Extend existing `sw.js` with `push` and `notificationclick` handlers; keep all existing offline fetch/cache logic untouched except a necessary cache-version bump.
2. Display generic notifications with `ServiceWorkerRegistration.showNotification()`, controlled tag and icon; no sensitive push payload in lock screen or static cache.
3. On tap, validate same-origin dashboard route, focus an existing window or open `dashboard.html`, then route via existing signed-in navigation to My Work, report or action **after authentication and role/tenant authorization**. Never trust URL-provided report/action IDs alone.
4. When notification is stale, record deleted, reassigned, or viewer no longer authorized: send to a safe dashboard view with neutral guidance. Do not leak details in a push, URL query string, or SW cache.
5. Ensure notification events don't fight existing realtime notifications or cause duplicate bell entries.

### D. Reliable server dispatch
1. Reuse `report_user_notifications.id` as the canonical event ID and `recipient_user_id`/organization for routing. Prefer an audited outbox triggered from event creation, rather than client polling alone.
2. Use a securely authenticated server-side sender, bounded batches, retries on transient failures, dead-letter handling, and strict 404/410 cleanup. Confirm a delivery result represents push-service acceptance, **not guaranteed display on the device**.
3. Avoid sending the same push more than once to the same device/event under duplicate triggering. Deduplicate per event/subscription and cap excessive notifications.
4. Recheck recipient active status and organization at delivery time. Resolve changes to role or assignment by following current authorization rather than past event recipients where appropriate.
5. Retain observability (events queued, service response, invalid subscriptions, retries) without storing sensitive payloads in logs. Keep a safe off switch for all push dispatch if an issue appears.

## 5. Test plan and minimum acceptance criteria

**Desktop and mobile matrix:** Chrome desktop, Edge desktop, Chrome Android where available, iPhone/iPad installed Home Screen staff PWA (iOS/iPadOS 16.4+). Apple Web Push on iOS/iPadOS is available to Home Screen web apps, with a permission request initiated by a direct user gesture; do not promise that a Safari browser tab alone will receive iOS push.

**Subscription/security tests**
- [ ] Admin subscribes on two devices; both receive one test; disabling one device leaves the other enabled.
- [ ] Safety Manager and Supervisor subscribe; each receives only authorized assigned work.
- [ ] Read Only role does not receive assignment/verification work not authorized for them.
- [ ] A separate test account cannot read, edit, remove, or send to another user's subscription.
- [ ] A separate company cannot access another company's devices, report events, action details or recipient list.
- [ ] Deactivate user, change role, reassign work, sign out on shared device, or remove tenant access → no unauthorized further push.
- [ ] Invalid/expired endpoint cleaned up; denied permissions handled without breaking email/in-app alerts.

**Event-to-device tests**
- [ ] Test all six current event types with intended recipient and safe lock-screen copy.
- [ ] Push arrives while PWA is in foreground, background and not open (as supported by platform).
- [ ] Clicking opens correct signed-in staff view; sign-in gate and inaccessible-item fallback behave safely.
- [ ] Duplicate event processing, repeated Edge Function execution and retry do not send duplicate alerts.
- [ ] No push subscription prompt on anonymous report form or to unsigned users.
- [ ] Existing browser/offline photo submission, QR paths, report creation, emails, dashboard, and role workflows still pass.

**Release acceptance**: At least one actual iPhone Home Screen PWA and one desktop/Android device receive background pushes, role-scoped cross-account checks pass, no secrets exposed, and user accepts the end-to-end experience. Do not mark PWA push complete solely from API acceptance.

## 6. RBH pilot launch checklist for this week

Recommended order (avoid parallel functional rework):
1. Build A–D with additive schema changes; make no destructive changes to existing reports or notifications.
2. Do the automated auth/RLS/duplicate tests; then live device tests with RBH test accounts and a sanitized test report.
3. Perform a focused final RBH smoke test: Admin, Safety Manager, Supervisor, Read Only; public reporting/Turnstile/QR, offline queue and photo, email, evidence, verification and close.
4. Finish the outstanding **expired-session Admin 401 browser regression** and review important Supabase security-advisor findings, especially publicly callable privileged functions, without breaking anonymous public intake.
5. Confirm backups/rollback, on-call contact, error logs, rate limits, support instructions, approved pilot users and communication. Record explicit go/no-go decision.
6. Invite the first RBH staff testers only after above acceptance; monitor real-world push delivery and workflow feedback closely. Keep pre-existing working email notification fallback.
7. Mark anything nonblocking as follow-up in the running backlog; do not allow feature creep to delay the RBH pilot.

### Pilot instructions to be prepared
- Steps to install **RBH Safety Operations** staff PWA from `dashboard.html` (distinct from the public reporting PWA).
- How to sign in, press Enable notifications, see permission status, disable this device, and report issues.
- Expected alerts and what to do if push is delayed or denied (check RBH email/in-app bell).
- Admin contact/support process and known device limitations.

## 7. Explicit deferrals and protection rules
- **Weekly Safety Pulse email digest: HOLD.** Preview, controlled test email and scheduler-readiness work passed, but company opt-in and delivery release are Off; do not create a live cron job.
- Keep the public anonymous report intake separate; do not prompt anonymous reporters for push permission.
- Do not touch unrelated GitHub or Supabase projects.
- Do not delete/rewrite existing report rows, corrective-action data, file attachments, profiles, or delivery histories.
- No unapproved mass email/push broadcasts. First sends only to controlled RBH test devices/accounts.
- Back out push by disabling sender/feature configuration, not by disrupting the existing service worker's offline reporting.

## 8. Handoff — next conversation starting instruction

**Resume the RBH PWA push notification MVP from this handoff.** Start with GitHub `mikelifesfood/RBH` and Supabase RBH project `owhkxguiavgxzwvbxevj`. Verify existing dashboard, `dashboard.webmanifest`, `pwa-client.js`, `sw.js`, and `report_user_notifications` before altering anything. Prioritize additive subscription schema, trusted Web Push sender, user opt-in, privacy-safe event routing, and iPhone Home Screen plus desktop testing. Implement and verify without disturbing reports, emails or offline intake. Return to the user only for necessary device/credential actions, decisions or actual end-user acceptance tests. Keep the weekly digest On Hold. Target an RBH staff pilot this week, subject to final release gates. Update `docs/RBH_TEAMWORKT_RUNNING_BACKLOG.md` as tasks pass.

## References
- Project backlog: `docs/RBH_TEAMWORKT_RUNNING_BACKLOG.md`
- Digest handoff (on hold): `docs/weekly-safety-pulse-digest.md`
- WebKit on iOS/iPadOS Home Screen web push: https://webkit.org/blog/13878/
- Apple Web Push: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- MDN Push event: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event
- MDN notificationclick: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event
