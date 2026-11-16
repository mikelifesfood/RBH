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
