# RBH / TeamWorkt Safety — full MVP acceptance and first pilot checklist
**Updated:** November 18, 2026
**Pilot target:** RBH real-user testing after offline validation, limited UI changes and explicit owner go-live approval.
**Non-negotiable:** Weekly Safety Pulse recurring email delivery remains **PAUSED**. Do not activate scheduler as part of pilot.

## Current engineering truth
- Offline Supabase tables/RPCs and a separate evidence function are deployed with **0 organizations enabled**.
- The locked staff offline workspace, encrypted local drafts, client integration and browser regression are on draft GitHub PR #2; not merged or live.
- Three corrective-action actions (completion, verification, changes requested) have explicit, revision-checked official online commit support. Other offline steps currently capture structured local draft data and require the existing official online UI to finalize. **Do not mark these end-to-end offline stages complete until user-verified reconciliation and submit are supported.**
- Action-specific offline evidence has a new deduplicated upload path. Investigation-level offline photos currently require explicit manual export and upload into the authorized online RBH evidence surface (not automatic submission). This is an intentional pilot-release gate, not a completed sync.
- Existing public reporting offline draft/queue is independent and must pass regression.

## Engineering readiness gates (before owner-led testing)
- [ ] CI protocol, Chromium, Edge checks green at latest commit; review every failed run.
- [ ] Complete official submission handoff for report review/classification, investigation, action planning, owner assignment, add-action-before-close, closure and any mandatory status change. Either support explicit guarded submission or consciously mark the step as *draft-only* and obtain pilot scope agreement.
- [ ] Confirm offline photos for every promised attachment surface have a user-visible safe recovery route; no hidden stranded evidence.
- [ ] Complete live RBH authenticated role/tenant/session permission testing (safe test records only), including disabled flag negative path.
- [ ] Verify server-authorized snapshots use correct report/action ownership and up-to-date revision fields.
- [ ] Confirm evidence retry, lost HTTP response, competing upload, revocation, removed owner, retired action, reopened generation, storage errors and quota errors.
- [ ] Verify existing online path, report audit trail, email/push notifications, and separate public QR/Turnstile reporting are unaffected.
- [ ] Confirm no data migration or testing overwrote existing reports; no test-data deletion or report sequence reset.
- [ ] Complete real installed iPhone PWA and Chrome mobile/desktop offline acceptance, including airplane mode, force-quit/reopen and app reinstall/storage eviction warning.
- [ ] Decide and approve controlled activation and rollback before any organization enabled or frontend merged to production.

## Start-to-finish user acceptance sequence
Record **Pass / Fail / Notes / Screenshot or report #** for each numbered scenario. Use synthetic RBH report(s) with authorized test users; isolate from live operations.

| ID | Scenario / expected outcome | Role | Result |
| --- | --- | --- | --- |
| 01 | Scan jobsite QR, enter public report online; one report #, protected intake works | Public | Pending |
| 02 | Repeat public report offline with photos; save-to-device only when offline, then explicit successful submission once connected (no duplicate) | Public | Pending |
| 03 | New report visible to right RBH users and dashboard Safety Pulse reflects it | Admin / Safety Manager | Pending |
| 04 | Initial email, assignment email and push notifications delivered only to subscribed eligible recipients | Admin / Safety Manager | Pending |
| 05 | Assign report owner/investigator, inspect per-role visibility and My Work | Manager / Supervisor / Read-only | Pending |
| 06 | Prepare offline work on device while online: strong passphrase, encrypted current assigned snapshot, time-to-expiry and storage warning | Manager / Supervisor | Pending |
| 07 | Airplane Mode / no network, launch installed PWA directly from icon, unlock account, read previously assigned work | Manager / Supervisor | Pending |
| 08 | Offline review/classification and investigation, including findings/root-cause; save and recover after force-quit and reopen | Manager / Supervisor | Pending |
| 09 | Offline draft corrective-action plan incl. >1 action / owner / due date / priority; recover without converting to official action automatically | Manager | Pending |
| 10 | Offline corrective-action completion notes and one or more photos; encrypted local persistence verified | Assigned action owner | Pending |
| 11 | Reconnect: review conflicts, submit photos manually with verified receipt, then confirm official completion exactly once | Assigned action owner | Pending |
| 12 | Verification flow: approve completed action or request changes, see appropriate role permissions and notifications | Safety Manager | Pending |
| 13 | Follow-up changes, additional corrective action before closure and report closure; verify permitted roles and audit history | Safety Manager / Supervisor | Pending |
| 14 | Signout and account switching: local drafts wiped for account and no cross-account incident visibility; wrong passphrase remains denied | All staff roles | Pending |
| 15 | Stale client revision, inactive user, wrong org, changed owner, repeated operation UUID and reopened workflow block stale submissions | Admin test users | Pending |
| 16 | Test online-only dashboard workflows, attachments, My Work, report close, notifications and role permissions unchanged | All roles | Pending |
| 17 | Verify weekly Safety Pulse **does not recur automatically** while held | Admin | Pending |
| 18 | Confirm requested UI cleanup and navigation on mobile/desktop; capture and retest any defects | Owner | Pending |
| 19 | Final data retention review and **separate explicit authorization** for deleting trial reports / resetting report number to 1 | Owner | Pending |
| 20 | Explicit RBH pilot go/no-go approval, rollback owner, support contact, and security gate check | Owner | Pending |

## Evidence/report handling expectations
- An offline draft is **not an official RBH record or completion**. No email/push/digest should be sent until a server-authorized official operation commits.
- Users must not rely on the device for indefinite storage. Current offline snapshot validity is 24 hours from sync and browser storage may be evicted.
- Reconnection must recheck active session, organization, role, ownership, report and action generation, last-updated revisions and server receipt.
- Network failure after server commit must not create duplicate attachments/actions. Do not erase encrypted local evidence until the server receipt is verified.
- The browser/client is not an authoritative permission source; complete server-side RLS/RPC checks.

## Go-live hold and change control
1. **Keep digest paused**; no recurring Monday 8:00 AM mail activation.
2. Complete offline engineering and role/device tests; gather defects in this document or backlog.
3. Only then make prioritized owner-requested UI changes, retest, and review exact changed files.
4. Deploy a clearly scoped RBH pilot build only after explicit approval. Do not expose unaccepted offline features to all customers.
5. Backup/export agreed pilot data before any owner-approved test report cleanup or report number reset; verify audit/retention obligations.

## November 18 staff offline candidate updates
- Controlled pilot account gate is deployed, defaulting to `pilot_only=true` and all organization/user switches OFF. Once explicitly approved, a specific authorized test user may be allowlisted without exposing offline UI to all RBH staff.
- The locked workspace now has separate structured offline fields for proposed report classification/severity, report owner/investigator, investigation, and **multiple proposed corrective actions** with owner, due date and priority per action. These are encrypted local drafts, **not official** assignment/plan submissions; managers still use the authoritative online RBH controls.
- The offline editor now warns about unsaved notes and unsaved selected photos, guards step/record/lock navigation during uncommitted edits and encrypted saves, and shows a count if the minimal assigned-report snapshot is truncated.
- The reconnect draft review now displays human-readable stage fields, not raw JSON. For investigation-level photos that cannot yet use the action-specific Edge endpoint, an explicit decrypted download is available so the user can attach manually using authorized online RBH controls.
- Added Chromium tests covering lost-response photo retry, classification/assignment and multi-action draft reload, unsaved navigation denial, and account/data isolation. Check latest GitHub Actions run before claiming green.
- **Outstanding engineering acceptance:** verify seamless handoff of non-action drafts to official online fields, full live RBH role/session/tenant tests, iPhone PWA acceptance, photo download/reupload privacy ergonomics and all existing workflow regressions. The current snapshot/review implementation does not itself close a report, assign staff, or activate a corrective plan.

## Final staged frontend handoff and gate — current developer status
- Locked PWA shell and explicit passphrase enrollment are implemented **on feature branch only**. Device enrollment is recorded as a non-sensitive Cache Storage marker; new service worker sends unenrolled offline dashboard requests to the original offline page, while an enrolled device receives the locked staff workspace.
- Online reviewed drafts have a "Copy draft for online form" action, with readable offline classification, assignment, investigation, planning and closure notes for manual paste/review in official RBH. The copy mechanism is *not* a server submission or merge operation; user must apply RBH's current role-authorized online workflow.
- Only action completion, verification and request-for-changes have guarded official one-click commit in the offline reconnect review. Do not say other stages have an automated official replay.
- Separate offline evidence v2 and authenticated server gate are already deployed. Default organization OFF and pilot-only allowlist still empty. **No frontend merge**, user activation, digest scheduler, test data deletion or report number reset.
- Device validation includes encrypted draft/photo reopen, mobile-style Chromium service-worker fallback, account isolation, mistaken navigation guard, stale/role/gate tests, lost-response retry, multi-action persistence and proposed owner/investigator recovery. Browser CI is not a replacement for an installed iPhone PWA.
- Owner-led UAT can begin only after a safe frontend deployment, a specifically authorized RBH test account is pilot-enabled, and expected roles and action evidence live checks are verified. Do not activate the whole organization or go live to staff prematurely.

## Automated development verification — final staged candidate
- GitHub Actions run **#44319351848**: **SUCCESS** on all three jobs — Chromium browser/PWA, Node workflow protocol, Deno Edge Function typecheck — at commit `f3e566af99a3993bed72010284a94464e6d6e399`.
- The browser suite includes explicit offline draft field copy into the user's clipboard after unlock and current online review. The test waits for the async clipboard operation and verifies both notes and investigation fields survive.
- **This is automated acceptance for the staged code, NOT end-to-end RBH customer acceptance.** Actual authenticated role/tenant tests, installed iPhone PWA and real storage upload need a controlled pilot flag and frontend visibility.
- Digest development paused, no recurring job. Pilot activation, frontend merge, real-user launch, data cleanup and report-number reset require appropriate owner decisions.
