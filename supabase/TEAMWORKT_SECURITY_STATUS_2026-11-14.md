# RBH / TeamWorkt Safety — Supabase Hardening Progress
Date: 2026-11-14
Target project: RBH Insulation `owhkxguiavgxzwvbxevj` ONLY.

> This branch contains incremental source-controlled hardening SQL and Edge Function code.
> **Do not** run the entire set blindly against a blank database.
> **Do not** deploy this branch to production without the full RBH application regression test.
> The RBH production DB already received the relevant migrations individually.

## Applied to RBH Supabase

- Internal trigger function EXECUTE grants restricted; `set_updated_at()` search path pinned.
- Anonymous execution of management RPCs and authenticated identity helper RPCs restricted.
- Report, profile, attachment, note, audit, feedback and Storage read policies made organization-aware.
- Public reporting payload and anonymous attachment metadata validated on the server.
- Browser role TRUNCATE, REFERENCES and TRIGGER privileges revoked.
- `notify-report` Edge Function requires `WEBHOOK_SECRET_NEXT` exclusively.
- Database `notify_new_report` trigger uses `vault.decrypted_secrets` by the name `rbh_notify_report_webhook_next` instead of hardcoded credential.
- One clearly labeled report test (#43) produced a `sent` notification event and a Brevo provider message ID (provider acceptance, not inbox delivery guarantee).
- User removed the old Edge Function secret `WEBHOOK_SECRET`.
- Auth identity lookups in affected policies now use initialization-plan expressions; the duplicate profile INSERT policy was consolidated.
- Five high-priority foreign-key indexes added; existing indexes were not deleted.
- Report restart, legacy corrective evidence, feedback, and in-app notification RPCs hardened to reject inactive or cross-organization access.
- System notes created by workflow restarts now carry the originating report's organization.

## Validation

- Performance Advisor: `auth_rls_initplan=0`; `multiple_permissive_policies=0`; `unindexed_foreign_keys=16`; remaining unused indexes should not be removed without workload evidence.
- Security Advisor: `anon_security_definer_function_executable=2`, corresponding to `submit_report` and `add_attachment` (intentional public intake); `authenticated_security_definer_function_executable=26` (needs ongoing authorization review, not blanket EXECUTE revocation); `rls_enabled_no_policy=3` (evaluate service-only tables before adding policies); `auth_leaked_password_protection=1` (dashboard-only Auth setting).
- Simulated authenticated manager read reports, notes and own in-app notifications after updates.
- Explicit cross-organization regression test PASSED: cannot view foreign report, cannot add evidence, cannot restart foreign report. Temporary organization and report changes were rolled back.
- Database currently has 4 reports (including labeled test #43) and 4 profiles. No records intentionally purged during hardening.

## Source-controlled files

- `supabase/patches/20261114_teamworkt_security_consolidation.sql`
- `supabase/patches/20261114_teamworkt_feedback_org_rls.sql`
- `supabase/patches/20261114_rbh_notify_report_vault_rotation.sql`
- `supabase/patches/20261114_teamworkt_rls_optimization_and_indexes.sql`
- `supabase/patches/20261114_teamworkt_rpc_org_hardening.sql`
- `supabase/functions/notify-report/index.ts` (rotated live function version 38)

## Remaining before commercial rollout

1. Enable leaked-password protection in RBH Authentication > Providers > Email if the Supabase project plan permits it. Consider stronger minimum password length and MFA as applicable.
2. Confirm 3 RLS-enabled no-policy tables are intentionally service-only: `organization_memberships`, `report_notification_events`, `report_workflow_restarts`. Do NOT grant general read permissions merely to remove lint findings.
3. Audit 26 authenticated executable SECURITY DEFINER RPCs individually. Some require trusted elevated execution; keep role and company checks explicit.
4. Build stronger anti-abuse control for anonymous intake: per-report signed upload tokens, file type validation, rate limiting/CAPTCHA and upload cleanup.
5. Avoid dropping the remaining unused indexes solely because the pilot has little traffic; examine query plans on real workloads.
6. Run browser regression on public report submission, attachments, login, dashboard, assignments, investigations, corrective actions, PDF exports, in-app notifications and Brevo delivery.
7. Create a proper *from-scratch* schema baseline and parameterized deployment configuration for each customer. Existing RBH patch files are incremental, not a complete install.
8. Make webhook delivery tolerant of transient failures and introduce operational retry/reconciliation where needed. Current Brevo provider acceptance is recorded; recipient delivery monitoring remains external.

**Important:** A SECURITY DEFINER advisor warning may indicate risk even if the function has an internal authorization guard; validate each function rather than treating all warnings as defects. The public submission RPCs intentionally need anonymous use.
