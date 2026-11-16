# RBH four-role authorization QA — 2026-11-16

Scope: Supabase project `owhkxguiavgxzwvbxevj` and `mikelifesfood/RBH` only.

## Status: PARTIALLY VERIFIED; BROWSER ACCEPTANCE OPEN
This document records live, server-enforced authorization tests, NOT full signed-off acceptance of four distinct logins.

### Preconditions
- At test time, active profiles: Admin 1; Read Only 3; Safety Manager 0; Supervisor 0.
- Deployed `admin-provision-user` Edge Function uses an authenticated Admin JWT to provision Auth user + profile + organization membership; the connected Supabase management interface does not expose a normal Auth Admin user-creation call or an authenticated RBH Admin session. No new Auth users were created by these tests.
- Selected an existing active Read Only profile for **transaction-scoped role simulations**. No profile role updates were committed; transactions used `ROLLBACK`. No permanent report, action, schema, or user changes were made.

### Tested (rolled-back SQL transactions impersonating the `authenticated` database role with a user JWT-sub context)
| Operation | Admin | Safety Manager | Supervisor | Read Only |
| --- | --- | --- | --- | --- |
| Assign report owner, nonexistent report | REPORT_NOT_FOUND (passed manager gate) | REPORT_NOT_FOUND (passed manager gate) | MANAGER_ROLE_REQUIRED | MANAGER_ROLE_REQUIRED |
| Assign self as report owner, existing open report | Success (rolled back) | Success (rolled back) | MANAGER_ROLE_REQUIRED | MANAGER_ROLE_REQUIRED |
| Save corrective-action plan, existing open report, empty array | AT_LEAST_ONE_CORRECTIVE_ACTION_REQUIRED (passed role gate) | Same | CORRECTIVE_ACTION_PLAN_NOT_AUTHORIZED | Same |
| Verify nonexistent corrective action | CORRECTIVE_ACTION_NOT_FOUND (passed manager gate) | Same | VERIFICATION_MANAGER_REQUIRED | Same |
| Read Only reads organization reports | — | — | — | 18 visible when tested |
| Read Only attempts own role escalation and organization reassignment | — | — | — | Both blocked by PROFILE_SECURITY_FIELDS_BACKEND_ONLY |

### Limits
- A completion RPC was attempted on an existing action, but the report was resolved; all four roles returned REPORT_ALREADY_RESOLVED. This tests a lifecycle block, **not** Supervisor's positive completion permissions.
- No actual Safety Manager or Supervisor Auth logins, active assigned work completion, evidence upload, send-back, verification on a pending action, Close button, user administration, or browser navigation was end-to-end tested.
- Transactional simulations do not substitute for real JWT login, the dashboard, Edge Function access, or cross-device behavior.

### Remaining gate
Provision distinct test Auth accounts via the deployed Admin-only `admin-provision-user` service (using a real authenticated RBH Admin session; do not inject Auth users directly with SQL). Then test Admin, Safety Manager, Supervisor, Read Only end-to-end in the dashboard using test-only reports and corrective actions, including positive and negative paths, and clean up tests safely. Do not mark four-role browser acceptance as passed before this is done.

## Change log
- GitHub: added this documentation only.
- Supabase: **no persistent change**.
- Frontend, Edge Functions, hosting: **no change**.

## Additional November 16 authorization test using explicitly approved account
- User authorized testing with `vignery12@gmail.com`. The account exists in `auth.users` and is an active RBH profile. Do not publish identifiers or credentials.
- Starting profile role: `read_only`. Its organization membership role was `safety_manager`, **inconsistent with its application profile**. Another RBH profile also has this class of mismatch. These require reconciliation in the canonical Admin provisioning/role-management path, without silently changing the other account.
- Transactionally simulated all four roles on that specific user using `SET LOCAL ROLE authenticated` and JWT subject context. Every test rolled back the role and report changes; the named profile remains `read_only` and membership remains `safety_manager` as originally found.
- On an existing open report: Admin and Safety Manager successfully entered `rbh_set_report_owner`; Supervisor and Read Only returned `MANAGER_ROLE_REQUIRED`.
- On an existing open report, empty corrective action plan: Admin and Safety Manager passed the permission gate and returned `AT_LEAST_ONE_CORRECTIVE_ACTION_REQUIRED`; Supervisor and Read Only returned `CORRECTIVE_ACTION_PLAN_NOT_AUTHORIZED`.
- Verification RPC with missing action ID: Admin and Safety Manager passed the permission gate and returned `CORRECTIVE_ACTION_NOT_FOUND`; Supervisor and Read Only returned `VERIFICATION_MANAGER_REQUIRED`.
- All simulated roles saw the existing 18 same-organization reports; this is consistent with the current all-staff report-view RLS and is not evidence of cross-organization access.
- **Not tested end-to-end:** real user sessions after role changes, UI permission and navigation, Supervisor's positive assigned-action completion and evidence upload, change-request/resubmission/verification/closure sequence, role-management via Admin Edge Function, and cross-tenant isolation. There were no active actions in the existing RBH data on November 16 (only three actions, all on closed reports), so positive Supervisor completion requires an isolated synthetic action lifecycle.
- No persistent Supabase configuration or records changed during these tests. Role acceptance remains partially verified, not fully signed off.

## Cross-check: authoritative user access source (2026-11-16)

**Conclusion:** `public.profiles.app_role` (together with `is_active` and organization ID) is the authoritative RBH operational access source. The dashboard's Admin role selector calls deployed `admin-manage-user` with `action:"set_role"`, which updates `profiles.app_role`; it does **not** update `organization_memberships.role`. The dashboard reads `currentProfile.app_role` and falls back to the `rbh_current_app_role()` RPC. Server-side report owner assignment, action planning, verification, reopen, notification settings, and report RLS rely on the active profile role. Admin user-management also enforces the caller's `profiles.app_role === "admin"`.

**Membership nuance:** `organization_memberships` supplies organization membership/legacy organization fallback, not elevated operational privileges. Its role values can lag behind current RBH dashboard roles. The `organizations` SELECT policy uses active membership as one path to seeing organization metadata; it does not imply ability to edit reports. If multi-org access is expanded commercially, reconcile its purpose explicitly before changing it.

**Live observation:** The authorized `vignery12@gmail.com` account was seen as `read_only` at initial inspection and subsequently changed to `supervisor` in `profiles.app_role` during this review while `organization_memberships.role` remained `safety_manager`. At final inspection, its application role was **supervisor, active**, and its membership role remained safety_manager. No test action persistently changed it; treat the observed supervisor role as the current user-selected role, not as a test artifact. One other profile had a stale membership role.

**Checked:** dashboard role/UI helpers; deployed `admin-manage-user` source; profile read/update policies and role-security trigger; reports/actions/notes RLS; manager-only RPCs; Supervisor report step-field restrictions; inactive-account read access. A transaction temporarily set this profile inactive, where authenticated queries returned zero reports/organizations/memberships, then rolled back. Profile self-promotion and organization reassignment were also tested previously and blocked. No persistent database data changed.

**Decision:** Do not change or auto-sync `organization_memberships` merely to satisfy cosmetic role matching without a design decision about its organization-membership purpose. Keep RBH operational access based on `profiles`. Existing stale membership rows should be tracked as consistency/administration cleanup, not falsely called authorization escalation.

**Open end-to-end QA:** Supervisor positive completion on an active assigned corrective action and evidence, send-back/reassignment, UI navigation after a real role switch, and final Close. At review time no unresolved report had an active corrective action to test; rolled-back auth simulations do not certify real browser login flows. Four-role acceptance is **not** fully closed.

Files changed in this review: this documentation file only. Supabase persistent changes: none. Frontend, Edge Functions, hosting: none.
