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
- **Assignment email delivery — ACCEPTED (user-tested, 2026-11-15):** User confirmed receiving initial new-report email, Report Owner assignment email, corrective-action assignment email, and corrective-action closed/completion email. Delivery for these four tested cases is signed off. Separate negative-path checks (no duplicate notifications on unchanged assignment, all delivery-mode configurations, and changes-requested notification) are not implied by this sign-off.
- **Not yet tested with eligible pilot accounts**: live Safety Manager and Supervisor task completion/verification cycles (RBH currently has no active accounts with those roles); create controlled test accounts before claiming complete role acceptance.
- **Safety Pulse — ACCEPTED (user-tested, 2026-11-15):** User confirmed the category/site display and reporting filters passed after the follow-up dashboard fix.
- **Job-site QR, offline photo, and Cloudflare Turnstile intake regression — ACCEPTED (user-tested, 2026-11-15):** User confirmed all three passed. These are implemented features, not pending development work.
- **Remaining acceptance:** Live Safety Manager / Supervisor role permissions are scheduled for 2026-11-16. Advanced notification negative-path scenarios remain separate optional coverage.

## Rollback
- Frontend: revert only the two named `dashboard.html` commits if needed.
- Backend: restore pre-change definitions of the five affected functions, the attachment registration function and investigator validator, and the previous report UPDATE policy from an audited schema snapshot; avoid guessing old permissions in a blind rollback.
- Never delete reports, owner assignments, corrective-action records, or email logs as part of rollback.
