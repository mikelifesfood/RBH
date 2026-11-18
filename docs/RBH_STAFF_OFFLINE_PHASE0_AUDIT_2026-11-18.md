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
