# TeamWorkt Safety — Build 6 Mobile UX & Sync Status
Date: 2026-11-15
Pilot: RBH Insulation
Repository: `mikelifesfood/RBH`, branch `main`

## Scope approved by the existing MVP handoff
Build 6 follows the documented Day-1 sequence after job-site QR and offline PWA: **mobile UX polish + accurate report synchronization/status display**. This is an interface-only build. The existing anonymous report intake, site-specific QR, four roles (`admin`, `safety_manager`, `supervisor`, `read_only`), investigation/assignment/corrective action permissions, Brevo routing, SQL functions and privacy boundaries are unchanged. No Cloudflare Turnstile deployment or second-customer provisioning was attempted.

## Implemented
- `index.html`: compact, accessible status strip above the public form showing online readiness, offline not-yet-submitted state, number of locally queued reports, a sending/pending state, report receipt with photos still pending, or reports that require correction. Includes a touch-friendly **Saved reports** jump link and visible pending count.
- `index.html`: queued reports distinguish **Sending — awaiting server confirmation** from **Saved on device — NOT submitted**. Reports received by the server distinguish **uploading photos** from **photos pending**. Invalid/rejected reports visibly require review. Manual retry on the pending banner is disabled while offline and shows reconnection guidance.
- `index.html`: narrow-screen improvements without reordering fields or changing reporting requirements: mobile font size 16px to avoid Safari input zoom, >=44px touch targets, improved safe-area padding, attachment remove hit area, full-width pending actions, stronger visual hierarchy and reduced motion support.
- `dashboard.html`: CSS-only mobile Safety Inbox refinements: searchable toolbar and two-column filter controls, a horizontally scrollable status-chip row, full-width report controls and improved mobile hit targets. Admin Job Site Edit/Delete and existing role-based controls retain their original authorization and event handlers.
- `sw.js`: cache version `rbh-public-shell-v11-20261115` refreshes the public form shell without clearing IndexedDB drafts, upload queue, receipts, or authenticated data. Existing private dashboard/no-API caching boundary is maintained.

## Checked before release
- Re-fetched `index.html`, `dashboard.html`, and `sw.js` after GitHub writes and checked JavaScript syntax (including existing inline scripts).
- Simulated seven connection-UI cases by extracting the actual new status function from GitHub source: online, offline empty, offline with one queued report, sending, photos pending, needs review and server-confirmed receipt. All returned expected state labels and counts.
- Confirmed no Build 6 SQL migrations, Edge Function deployments, new roles, permission changes, or email recipient changes.
- Earlier Build 5 device tests from the owner verified photo draft restore, offline queueing, automatic submission and one report appearing in the dashboard. The owner's confirmation that the photo appears on the submitted report in the dashboard was not supplied separately; check that when testing.

## Owner browser acceptance (not independently device-tested)
1. Open the public reporting form on iPhone Safari online and refresh once. The compact strip should read **Online — ready to report**, and the button should jump to **Saved reports**.
2. Toggle airplane mode after loading the form: the strip should read **Offline — saved reports are not submitted** and keep all previously saved draft details/photos. **Retry now** should be disabled while offline.
3. Queue a fictional non-injury report offline. The Saved reports count should increase, and the queued report must clearly say **NOT submitted**, without a server reference.
4. Reconnect and keep Safari open. The strip/status should transition through sending (possibly too quickly to see), then server receipt, photo upload pending if applicable, and finally show an acknowledged reference. Confirm exactly one report and its photo in the dashboard.
5. Use the dashboard on mobile: open **Safety Inbox**, scroll filter chips horizontally, choose a job-site filter, open a report, and confirm existing actions and access remain unchanged.
6. Open Admin on iPhone as Admin: the Job Site Edit/Delete buttons should remain usable and not overlap. Do not delete real job sites during this UI test.
7. Check Spanish labels, iOS keyboard zoom and large-text readability.

No browser-only source check establishes actual touch/viewport rendering on iOS or Android. Do not label device acceptance complete until the owner verifies.

## Changed paths (Build 6)
- `index.html` — changed (responsive reporting UI + sync status only)
- `dashboard.html` — changed (responsive CSS only)
- `sw.js` — changed (cache version bump)
- `docs/TEAMWORKT_BUILD6_MOBILE_UX_QA_2026-11-15.md` — new
- `supabase/TEAMWORKT_RBH_MVP_GOLIVE_HANDOFF_2026-11-14.md` — updated handoff

## Follow-on work
- Public anti-abuse protection (Turnstile Managed or approved alternative) requires customer decisions on hosting, sitekey and server secret, as documented in the original handoff. Do **not** apply a frontend-only CAPTCHA or revoke anonymous `submit_report` before a coordinated backend cutover.
- Execute the full role-by-role incident → assignment → investigation → corrective work → independent verification → closure regression and prepare a sanitized fresh-customer installation; they are subsequent MVP gates.
