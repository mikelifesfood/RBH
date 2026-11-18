# RBH staff offline — Phase 0 audit and Phase 1/2 foundation status
Date: 2026-11-18
Branch: `feature/staff-offline-foundation-20261118`
Status: **IN PROGRESS — NOT DEPLOYED / NOT ACCEPTED**

## Live baseline verified
- RBH production Supabase project `owhkxguiavgxzwvbxevj`: ACTIVE_HEALTHY, PostgreSQL 17.
- GitHub `mikelifesfood/RBH` default branch `main`. Public repo. Only add public client code; never secrets, keys, or private incident records.
- `dashboard.html` (9,816 lines at inspection) makes server-side RPC calls. Completion: `rbh_submit_corrective_action_completion`; verification: `rbh_verify_corrective_action`; send-back: `rbh_request_corrective_action_changes`; corrective plan: `rbh_save_corrective_action_plan` / `rbh_activate_corrective_action_plan`; additional actions: `rbh_add_corrective_action_before_close`; report owner: `rbh_set_report_owner`. Evidence: `manage-action-evidence`.
- `sw.js` intentionally caches only public shell. **Do not add incident snapshots, tokens, or the authenticated dashboard to public caches before designing the locked offline shell.**
- Existing public intake uses IndexedDB `rbh-safety-offline-v1`, completely separate from staff storage.
- Production `reports` has `updated_at`, `workflow_restart_count`, `reopen_count`, `status` and `organization_id`. `report_corrective_actions` has `updated_at`, `workflow_generation`, `status`, `organization_id`, owner/verifier IDs. These are candidate server revision inputs, not a proven concurrency protocol.
- RBH notification and push mechanisms already exist. A local draft must never emit events.
- Weekly Safety Pulse scheduled digest is ON HOLD. Test-data cleanup and report-number reset require explicit owner approval.

## Files added (feature branch only)
- `staff-offline-foundation.js`: standalone, unreferenced browser module; encrypted JSON draft saves and reads, plus encrypted photo evidence bytes and filename/checksum metadata; tenant/user/report/action/generation/step scope; PBKDF2-SHA256 + AES-GCM with per-record salt and IV; authenticated encryption binds ciphertext to record ID; verifies IndexedDB read-back after transaction; supports lock, scoped listing, and verified deletion.
- Explicit passphrase requirement (12+ characters); key/passphrase in memory only; not a JWT and not stored in localStorage, IndexedDB or Cache Storage. Passphrase recovery is **not** implemented. Avoid persisting data until a suitable user-facing key management and recovery policy is approved.
- `staff-offline-protocol.js`: pure, side-effect-free intent state machine with explicitly confirmed operations, stale role/tenant/report/action/revision checks, and verified server receipts; does not initiate HTTP calls.
- `supabase/patches/20261118_staff_offline_idempotent_action_commit_STAGED.sql`: not deployed; staged private idempotency ledger and additive RPC wrapper for three action transitions, preserving the existing audited RPC authorization logic. Requires database and transaction rollback testing before application.
- `tests/staff-offline-protocol.test.cjs` and `.github/workflows/staff-offline-regression.yml`: 5 protocol tests including invalid confirmation, wrong tenant/role, stale revisions and receipt binding; GitHub Actions run #44298414282 **PASS** on the feature branch.

## Important security/design limits
1. This module is **not imported into the dashboard**, feature-flagged OFF by omission, and is not an offline solution yet. No claim of real-device acceptance.
2. User identity/tenant binding must be verified by the authenticated dashboard and server. Local scope arguments are never an authorization mechanism. Same-device data remain present until explicitly deleted; an offline device cannot immediately learn that a role was revoked.
3. Encrypted draft contents are protected by the supplied passphrase. Draft identifiers, including user/report IDs and save times, are metadata visible in IndexedDB; review whether even this metadata is too sensitive for customer devices.
4. Evidence/photo encryption is staged but not integrated or device-tested. Local snapshot rights, key recovery, UI wiring, workflow draft restoration, submission/outbox, conflict diffs, deployed server-enforced idempotency and authorization, mobile startup and role tests are **NOT BUILT**.
5. Passing a simple browser `navigator.onLine` test is insufficient. Reconnection must establish live authentication, permissions and revisions.
6. Local browser storage can be cleared/evicted, especially on iOS. Never describe it as a guaranteed backup.
7. SQL is staged in GitHub only. No database migrations, data deletions, email/push changes, or production function deployments in this phase.

## Workflow integration inventory — initial map
| Staff step | Live operation/path | Offline strategy | Acceptance |
| --- | --- | --- | --- |
| Assigned report read | Supabase report queries | Minimum authorized snapshot with expiry and locked access | Not started |
| Report owner assignment | `rbh_set_report_owner` | Local intent then recheck permission/revision and confirm online | Not started |
| Investigation and classification | Dashboard step handlers, report updates | Per-step local encrypted draft and server revision | Needs detailed call audit |
| Corrective action plan | `rbh_save_corrective_action_plan`, `rbh_activate_corrective_action_plan` | Draft plan, explicit online activation | Not started |
| Additional action | `rbh_add_corrective_action_before_close` | Local draft; verify report still open | Not started |
| Action completion | `rbh_submit_corrective_action_completion` | Locally saved note, explicit online completion | Not started |
| Evidence | `manage-action-evidence` | Encrypted bytes, content hash, idempotent upload/reconciliation | Not started |
| Verification | `rbh_verify_corrective_action` | Local reviewer note; explicit online decision | Not started |
| Request changes | `rbh_request_corrective_action_changes` | Local reason; explicit online decision | Not started |
| Closure/reopen | Dashboard workflow RPCs | Local preparatory data only; gate on server state | Needs detailed call audit |
| Public intake | `offline-queue.js` | Leave untouched, regression only | Previously working |

## Next implementation gates (not optional)
- Review DB and RPC definitions, including authentication/role checks, timestamps, server-side optimistic concurrency and storage handling.
- Create a secure, locked offline staff shell and minimal, permission-filtered snapshot. Do not reuse public SW cache for confidential data.
- Decide key handling, local data retention, sign-out/account-switch behavior and organization-level OFF-by-default rollout.
- Expand encrypted stores to binary evidence and recoverable drafts; integrate individual wizard and focused action forms.
- Implement server-side revision guards + per-operation idempotency with additive migrations and tests *before* any offline queue sends mutations.
- Test wrong account/role, stale report, changed action owner, reopened generation, lost server response, double submission, storage quota, expired session and revoked access.
- Run desktop Chrome and actual installed iPhone PWA testing before marking RBH offline go-live gate complete.

## Explicitly unchanged
Production dashboard/Service Worker, public reporter, report data, staff accounts, RLS, email and push, cron schedules, weekly digest and report numbering.


## November 18 implementation update — isolated feature branch
- `dashboard.html` on the feature branch now includes an authenticated device enrollment panel and on-device encrypted autosaving for the focused corrective-action view, wizard child action notes, and investigation findings/root cause. Existing online commit RPCs remain intact.
- `staff-offline-workspace.html` is a static, locked shell for previously synchronized, permission-filtered assigned work. It drafts report review, investigation, action planning, completion, verification/send-back, additional action and closure notes; photo evidence is encrypted locally. It **does not** synchronize or officially commit any workflow changes.
- `sw.js` on the branch handles offline staff dashboard navigation by showing the static locked workspace shell. No dashboard HTML, Supabase responses, reports, credentials or evidence are cached in Cache Storage.
- `staff-offline-bootstrap.js` offers explicit per-device enrollment, encrypts a 24-hour assigned-record snapshot, and scopes data by account. Explicit logout/account switching purges local work; sign-out warns before erasure if enrolled.
- `staff-offline-protocol.js` is an entirely pure, testable, user-confirmed transition state machine. It **does not send** uploads or RPCs. No automatic action status changes on connection restoration.
- Database SQL files and updated `manage-action-evidence` Edge Function source are staged in the branch, **not deployed**. The SQL wrapper preserves existing audited RPC role and lifecycle logic and adds per-actor stable operation IDs and optimistic revision checks. The Edge Function optional offline evidence route uses a deterministic client UUID and SHA-256 with strict owner/tenant/action/revision authorization and requires an additive schema migration.
- Browser regression suite `tests/test_staff_offline_browser.py` covers fictional-case IndexedDB/photo persistence, offline PWA shell fallback, account mismatch, passphrase mismatch, and account deletion. CI is on GitHub Actions using Ubuntu 24.04 with Playwright Chromium; browser acceptance must only be marked passing after the actual run succeeds.

## Unresolved / pilot-blocking
- Integrate the staged server action RPC and evidence uploader **only after** database migration validation, transactional rollback tests, and full security authorization tests.
- Add a safe explicit reconnect review/outbox, server revision comparisons and conflict choices for all workflow stages; verify all intended offline draft types can be restored into the live dashboard without silent overwrites.
- Complete additional workflow surfaces and action-plan details (including multiple planned actions); verify all workflow roles and states.
- Validate photo upload recovery when the server accepted the object but the response was lost, competing retries, cross-tenant denial, and storage failure.
- Verify real iPhone Home Screen PWA offline launch/force quit and Chrome browser behavior. Headless Chromium alone is not device acceptance.
- Require completed end-to-end regression, security review, launch flag, deployment and rollback before merging into `main`.
- Running backlog, RBH weekly digest hold and final test data are unchanged in production; do not reset sequence or delete reports without owner's explicit approval.


## November 18 follow-up — confirmed branch integration and review gates
- The previous note that no official upload/commit integration exists is superseded **on the feature branch only**: authenticated online `Review saved drafts` now offers individually confirmed evidence upload and individually confirmed corrective-action completion, verification and changes-requested submission. **No automatic replay** occurs on reconnect.
- `staff-offline-action-submit.js` requires current signed-in user, tenant, action generation/reopen cycle, exact stored revision, an enabled org feature flag, zero unuploaded evidence, durable operation key and a bound server receipt. A lost HTTP response preserves its key for safe retry.
- `staff-offline-evidence-replay.js` requires authenticated protocol-version handshake, file digest, stable attachment UUID, existing-action authorization, exact revisions, an explicit confirmation and server receipt. The staged server Edge Function additionally checks live Supabase session via `rbh_staff_offline_status` instead of merely reading the flag with service-role privileges.
- Three additive SQL scripts cover tenant rollout flag (OFF by default), private role-bound idempotency ledger, guarded nested RPC dispatch and evidence deduplication. Latest SQL combination **passed transactional rollback dry-run** against the RBH Supabase schema, including anonymous execute denial, private ledger access and no enabled tenants. **No SQL was persisted**.
- IndexedDB tests now also cover wrong tenant/user isolation for drafts/photos and expired snapshots. Feature-gated enrollment is hidden when company access is disabled. The online enrollment path asks the browser for persistent device storage and gives a warning if persistence is not guaranteed.
- GitHub Actions run #44310923605 **SUCCESS**, covering Node protocol safety, Chromium PWA/offline storage and workflow replay mocks, and strict Deno TypeScript check for the staged evidence Edge Function.

### Still blocking MVP release
- **No server migration, Edge Function update or dashboard merge has been deployed.** The currently live RBH system is unchanged.
- Full integration tests of real authenticated Supabase users/roles, actual Edge Function and storage replay under lost-response/concurrent retry, and real iPhone Home Screen PWA offline/reopen behavior are not complete. Mocked Chromium success is not enough.
- Offline review, investigation, action-plan, reassignment, close and reopen stages currently preserve structured notes and evidence but are **not yet one-click atomic official submissions**. Existing online RBH functions remain the authoritative way to finalize these stages.
- Before deployment, confirm lifecycle transition matrix, refresh and conflict reconciliation, data-retention UX, monitoring/rollback, and final RBH pilot acceptance.
- Preserve all existing report numbers and test records until the explicitly requested final reset. Continue holding the Weekly Safety Pulse recurring digest.
