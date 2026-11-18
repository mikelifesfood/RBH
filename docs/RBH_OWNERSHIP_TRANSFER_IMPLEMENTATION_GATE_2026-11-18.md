# RBH report/action ownership handoff — implementation gate (2026-11-18)

## Approved product rules
- All ACTIVE company users may READ company reports and corrective actions.
- Only current Report Owner changes report workflow fields. A Safety Manager who is NOT owner sees it read only.
- Unassigned open reports may be claimed by eligible Admin/Safety Manager.
- A Safety Manager who owns a report may OFFER transfer to another eligible manager; transfer takes effect only when recipient ACCEPTS; recipient can DECLINE.
- A nonowner Safety Manager cannot take another person's report. An Admin can take an open report with mandatory reason and audit, including when original owner unavailable.
- A current Report Owner may reassign an open corrective action, without changing the report owner's identity or any other corrective-action assignments.
- Only assigned corrective-action owner may enter completion or evidence. A separately assigned verifier can verify or request changes; being Safety Manager alone does not authorize either.
- Supervisor and Read Only cannot claim/reassign/transfer any report or action. Supervisor can complete only assigned action.
- Revoked owner access applies to direct API, database RPC and offline replay, not merely hidden buttons.
- Data, existing assignments, report numbers, old audits and digest state must remain unchanged.
- An ownership **offer** alerts recipient; accepted offer and Admin reassignment alert new owner. Corrective-action reassignment alerts the new assignee.
- Every event must create an in-app notification plus idempotent transactional email via Brevo and (for opted-in devices) push. Delivery must be logged separately. No emails or pushes for drafts, rejected/expired transfers, or rolled-back transactions.

## Files staged, NOT deployed
- supabase/migrations/20261118_report_ownership_transfers_STAGED_NOT_APPLIED.sql: transfer table, request/accept/decline RPC, Admin takeover/audit.
- supabase/migrations/20261118_corrective_action_ownership_STAGED_NOT_APPLIED.sql: claim unassigned, owner-restricted corrective action reassignment/audit.
- Both scripts were executed together inside BEGIN/ROLLBACK against RBH Supabase for schema/PLpgSQL parsing. No persistent DB objects or records created.

## CRITICAL: Do not deploy staged migrations alone
The current dashboard uses rbh_set_report_owner to change owners immediately; that existing privileged RPC still allows any active Safety Manager to overwrite an existing owner. Existing report UPDATE RLS also allows all Safety Managers to modify reports, and child action completion RPC allows manager-wide completion. These must be restricted consistently with role-scoped verification, workflows and internal legitimate triggers. Existing add-to-plan and plan-activate RPCs must also be scoped. Direct updates to legacy report action columns and notes/evidence need scrutiny.
The current email function is browser-triggered on assignment events; an accepted transfer must not depend on the previous owner/browser remaining online. Implement durable, deduplicated notification dispatch and event-specific email templates. Existing push dispatch allowlist does NOT include a transfer-offer event; it must be added with fixed safe text and server-side recipient and session validation.
Current Dashboard is ~798 KB and still permits manager-wide edits. Do not merge this branch until it is brought into sync with the new RPCs and verification state.

## Required acceptance tests
1. Manager A owns report: A edits; Manager B reads, B cannot edit via direct REST/RPC.
2. A requests transfer to B: A retains permissions; B sees offer, receives email and push (if opted in).
3. B declines: A retains ownership; no owner-change email/push.
4. A requests again; B accepts: B edits; A becomes read-only immediately. Child action owners remain unchanged.
5. Duplicate acceptance, stale transfer, expired session, inactive B and wrong-tenant B fail atomically.
6. B (nonowner) cannot reassign action; B after ownership can reassign one action, preserving sibling assignments.
7. Previous action owner loses online/offline submission ability; new action owner gains it. Current verifier retains specifically granted verification rights.
8. Admin takeover with reason succeeds, audited and notifies new owner; Admin cannot silently bypass audit.
9. Supervisor/Read Only cannot take/transfer/reassign or use direct functions. Admin cannot edit without taking over when nonowner.
10. Notifications: offer/accepted/action transfer routed to correct recipient; exactly one Brevo email and push per eligible delivery, opt-out respected; no duplicates on retry.
11. New report initial assignment, manager investigation, planning, action completion, verification, closure, reopen, attachments, public offline intake, staff offline queue and digest hold all regressions pass.
12. Existing records preserved; verified email/push receipts and real-device notification clicks documented.

## Deployment gate
Apply schema, permission changes, dashboard, notification Edge functions and push worker as one coordinated rollout with verified CI and rollback. Never treat migration-only staging as complete production functionality.
