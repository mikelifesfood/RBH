# RBH role and workflow alignment — November 15, 2026

## Approved operational permissions

| Capability | Admin | Safety Manager | Supervisor | Read Only |
| --- | --- | --- | --- | --- |
| View authorized company reports | Yes | Yes | Yes | Yes |
| Assign and own a report | Yes | Yes | No | No |
| Investigate report and decide corrective-action plan | Yes | Yes | No | No |
| Create and assign corrective actions | Yes | Yes | No | No |
| Complete assigned corrective action | Yes | Yes | Only assigned own actions | No |
| Submit corrective action for review | Yes | Yes | Only assigned own actions | No |
| Verify action or request changes | Yes | Yes | No | No |
| Close full report | Yes | Yes | No | No |
| Manage users and organizational settings | Yes | No | No | No |

A corrective-action owner marks work **completed / awaiting verification**. Only Admin/Safety Manager can **verify / request changes**. Verified is not the same as closed report.

## My Work (frontend)
- Report Owner (field `reports.report_owner_user_id`) sees their report through every open workflow stage, regardless of `investigator_user_id`.
- Assigned corrective actions are shown independently from report cards, and are linked to their focused action workspace.
- Managers see available corrective-action verification work in a separate Review queue; Review queue is role-accessible rather than a personal verifier assignment.
- Resolved reports do not count as open My Work; the Safety Inbox retains report history.
- Legacy `investigator_user_id` is not a current workflow assignment source. No historical investigator assignments existed on deployment.

## Production changes made
1. `dashboard.html` — My Work report-owner filter and missing report-card renderer (commit `09c55ba`).
2. `dashboard.html` — Manager-only report editing and owner self-assignment email path (commit `d5dae9e`).
3. `supabase/migrations/20261115_report_owner_role_alignment.sql` — deployed: remove Supervisor investigator permission from report planning RPCs, row-update policy, and step guard.
4. `supabase/migrations/20261115_retire_legacy_investigator.sql` — deployed: reject fresh legacy investigator assignments; do not allow Supervisor attachment upload authorization through legacy investigator/report-owner fields.

Retained: public reporting, offline upload mechanisms, action-specific completion RPC, management verification RPC, read-only report access, existing Admin/Safety Manager report-owner eligibility.

## Notification behavior
- Initial intake notice: per-company Grouped / Individual / Off to active Admin/Safety Manager, independent of workflow mail.
- Newly assigned Report Owner: target current owner, including self-assignment; existing Edge Function `send-action-assignment-email` with `notificationType=report_owner_assignment`, event deduplication and audit.
- Corrective action assigned: assigned owner; changes requested: owner; submitted completion: Report Owner (fallback manager routing where applicable).
- Assignment emails should not resend for unchanged assignments. Workflow retries use existing event keys.

## Verified versus still needing live tests
- Verified: #58 has an active Admin Report Owner; My Work browser acceptance was reported passed; migrated SQL functions and report RLS predicate inspected after deployment.
- Code-verified, **not yet provider-tested after these changes**: Report Owner self-assignment sends email exactly once. No backfill emails were sent for old assignments.
- **Not yet tested with eligible pilot accounts**: live Safety Manager and Supervisor task completion/verification cycles (RBH currently has no active accounts with those roles); create controlled test accounts before claiming complete role acceptance.
- Subsequent priority: Safety Pulse browser QA, intake after lockdown, offline-photo regression and notification setting QA from the November 15 handoff.

## Rollback
- Frontend: revert only the two named `dashboard.html` commits if needed.
- Backend: restore pre-change definitions of the five affected functions, the attachment registration function and investigator validator, and the previous report UPDATE policy from an audited schema snapshot; avoid guessing old permissions in a blind rollback.
- Never delete reports, owner assignments, corrective-action records, or email logs as part of rollback.
