# RBH offline-first backend deployment record — November 18, 2026

## Approval and scope
Owner explicitly approved deploying the **additive RBH Supabase changes and isolated offline Edge Function with offline functionality disabled by default**.

Target: Supabase project `owhkxguiavgxzwvbxevj` (RBH Insulation), Postgres 17.
Deployment performed against the existing RBH project; no GitHub pull request was merged.

## Applied migrations (confirmed by migration history)
1. `rbh_staff_offline_organization_gate_disabled_20261118`
   - Creates RLS-protected `public.staff_offline_settings` with default `enabled=false`
   - Creates `public.rbh_staff_offline_status()`, which checks current profile, active Auth session and tenant
   - **No tenant entries inserted** — all organizations disabled
2. `rbh_staff_offline_idempotent_action_rpc_20261118`
   - Creates private RLS-protected `teamworkt_internal.staff_offline_operations` ledger
   - Adds `public.rbh_commit_offline_corrective_action(...)` with role/tenant/revision/session checks, duplicate-operation replay prevention and existing workflow-RPC dispatch
   - Authenticated execute only. Requires organization flag ON, which is currently not enabled
3. `rbh_staff_offline_evidence_deduplication_20261118`
   - Adds optional attachment fields `offline_evidence_id`, `offline_evidence_sha256` and `offline_uploaded_by`
   - Adds unique partial idempotency index and NOT VALID digest CHECK (enforced for new writes)
   - No existing attachment rows rewritten or deleted

## Deployed Edge Function
- Name: `manage-offline-action-evidence`
- Version: **1**, ACTIVE, `verify_jwt=true`
- Source: `supabase/functions/manage-offline-action-evidence/index.ts` on this feature branch
- Source retrieved from deployment and byte-for-byte matched to GitHub branch content (18,411 characters).
- Function checks active staff session and organization flag via `rbh_staff_offline_status()`; only offline-specific idempotent uploads and the capability handshake are allowed.
- **Existing `manage-action-evidence` remains version 13** and is untouched.

## Confirmed post-deployment checks
| Check | Result |
| --- | --- |
| Supabase project active/healthy | PASS |
| Migration history contains all three named migrations | PASS |
| Enrolled / enabled organizations | **0 / 0** — OFF |
| Offline action commits | **0** |
| Offline evidence uploaded | **0** |
| Anonymous EXECUTE on both new public RPCs | DENIED |
| Authenticated direct SELECT on private operation ledger | DENIED |
| RLS enabled on new settings and ledger tables | PASS |
| Three evidence columns, unique index and digest constraint present | PASS |
| New Edge Function active, JWT verification enabled | PASS |
| Deployed Edge source matches GitHub branch | PASS |
| Existing live evidence function version | 13 (unchanged) |

## Security-advisor context
After deploying, Supabase Advisor reports two new `rls_enabled_no_policy` INFO findings for settings/ledger. This is **intentional**: these tables must not expose rows directly to end-user roles. It also reports the new `authenticated_security_definer_function_executable` notices; both functions are intentionally authenticated RPCs with internal authentication/tenant/feature checks. These findings were reviewed, not silently dismissed.

## Invariants and follow-up
- **Offline is NOT enabled for RBH or any tenant.** Do not insert/update `staff_offline_settings.enabled` until explicit pilot authorization and acceptance checks.
- No report, action, notification, user account, email digest, push service, scheduler, storage object, or report numbering was changed as part of this deployment.
- Draft PR #2 remains unmerged; no new front-end/offline shell has been published to the production site.
- A live authenticated end-to-end upload/commit was **not** attempted because the feature flag is OFF as requested; this is not full pilot acceptance.
- Next: authenticated negative-role/tenant/expired-session checks and controlled integration test plan, then real iPhone PWA validation, rollback and rollout verification.
- Weekly Safety Pulse recurring digest remains **on hold**.
- Do not purge test records or reset report sequence until separate explicit authorization.

## Emergency controls
Because no organizations are enabled, the new endpoints currently have no authorized write path. If ever enabled prematurely, set `staff_offline_settings.enabled=false` for that organization immediately. The additive objects are designed to remain inert; avoid dropping the ledger without an audit-retention review.

## Follow-on isolated Edge hardening and validation (same date)
- Updated only `manage-offline-action-evidence` to **v2**; `verify_jwt=true`, ACTIVE. New offline uploads reject zero-byte, oversized, and non-image files using an explicit JPEG/PNG/WebP/HEIC/HEIF MIME allowlist. Original `manage-action-evidence` remains at v13.
- Confirmed exact deployed v2 source matches the feature-branch file; no offline tenants enabled, no offline actions committed, no offline evidence uploaded.
- GitHub CI run **#44315920548** passed all protocol, real Chromium browser and Edge TypeScript jobs after the hardening syntax correction. Added further simulated lost-response evidence recovery regression in the next test commit; verify its latest CI separately.
- Found no active `cron.job` matching Safety Pulse/digest in RBH's cron schema; recurring digest remains on hold.
- Full RBH acceptance matrix is in `docs/RBH_PILOT_START_TO_FINISH_ACCEPTANCE_2026-11-18.md`.
