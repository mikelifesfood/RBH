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
