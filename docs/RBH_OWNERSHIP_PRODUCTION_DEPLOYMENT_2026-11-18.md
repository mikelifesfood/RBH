# RBH ownership transfers — production deployment record (2026-11-18)

## Live release
- Repository: mikelifesfood/RBH, main commit 88afe6469f7c0eaff10dc9cdd1d5a46191fbb466 (merged PR #4)
- GitHub Pages build and deployment: SUCCESS for this commit
- GitHub Actions: RBH PWA Push regression SUCCESS; Staff offline safety regression SUCCESS
- Supabase: RBH Insulation project owhkxguiavgxzwvbxevj
- Seven RBH ownership migrations successfully applied via Supabase migration API:
  1. rbh_ownership_transfer_workflow_20261118
  2. rbh_action_ownership_reassignment_20261118
  3. rbh_ownership_notifications_20261118
  4. rbh_ownership_transfer_inbox_20261118
  5. rbh_ownership_authorization_guards_20261118
  6. rbh_action_reassignment_notice_fix_20261118
  7. rbh_ownership_email_retry_20261118
- Source filenames retain STAGED_NOT_APPLIED in GitHub as historical source filenames, but these **seven specific migrations are applied in production**. Supabase migration history is authoritative.

## Deployed Edge Functions
- notify-ownership v1, ACTIVE, verify_jwt=false with webhook-secret auth
- push-dispatch v12, ACTIVE, verify_jwt=false with dedicated sb_secret backend authentication
- manage-action-evidence v14, ACTIVE, verify_jwt=true
- manage-offline-action-evidence v3, ACTIVE, verify_jwt=true
- Existing send-action-assignment-email v21 preserved.

## Permissions
- Everyone active in the company may view reports.
- Only current report owner may edit the report, initiate manager transfer, assign verifier and reassign active corrective actions.
- Another eligible manager can accept/decline an owner's offered transfer; old owner's report edit rights expire immediately on acceptance. Existing action assignments unchanged.
- Admin can take report (reason required and audited). Admin reassigns actions through owner-capable RPC, reason required and audited.
- Corrective action completion and evidence are restricted to assigned action owner, including offline RPC replay. Verification restricted to explicitly assigned verifier.
- Supervisor and Read Only cannot claim reports, transfer ownership or reassign actions. Read Only cannot complete actions.
- Reassignment is restricted while an action is awaiting verification or verified.
- Dedicated action verifier assignment available from report owner screen.
- Direct report UPDATE RLS and internal SECURITY DEFINER triggers implement authorization independently of the UI.

## New notifications
- Report offer: new prospective Report Owner receives in-app, Brevo email and opted-in push.
- Accept: new owner gets report owner assignment, old owner gets ownership transferred notice; both email and eligible push.
- Decline: current owner gets email and eligible push.
- Admin takeover: new owner report assignment; displaced owner transferred notice; email and eligible push.
- Action reassignment: new and old owners receive respective in-app/email and eligible push notifications.
- Push has fixed privacy-safe content, device opt-in/active session/tenant checks and one-minute dispatch.
- Ownership emails are webhook triggered with separate five-minute retry scheduler; audit via report_notification_events, deduplicated event keys.
- No notification delivery claims are made for real handoffs yet: no real ownership transactions executed on production outside rollbacks.

## Testing and data preservation
- Full staged migrations passed BEGIN/ROLLBACK before production deployment.
- AFTER deployment: real production SQL transaction with simulated manager and admin JWT:
  denied unrelated manager, preserved owner until acceptance, accepted owner change, preserved child owner assignments, reassigned child owner, new action owner submitted, generated expected notification events. ALL ROLLED BACK.
- Separately: designated verifier update test and Read Only denied claim/reassignment/completion passed; ROLLED BACK.
- Pre/post record counts: 24 reports, 18 corrective actions, 109 report audit, 83 corrective action audit; zero actual transfer/reassignment/override records created by deployment.
- All new RPCs have anon EXECUTE revoked, authenticated EXECUTE only and internal role/tenant checks.
- Weekly Safety Pulse: enabled=false and delivery_ready=false, no digest cron job.
- Push dispatcher remains active; ownership email retry active separately.
- Existing records, report numbering and test data preserved.

## Real-device pilot acceptance still REQUIRED
1. On installed PWA, owner opens Report options > Transfer, selects different Safety Manager, sends offer. Verify current owner remains editable until acceptance.
2. Recipient Home transfer inbox > Accept / Decline. Confirm live owner and read-only change.
3. Admin takeover with audit reason. Confirm previous owner's notification.
4. Report owner uses Reassign corrective action. Confirm only new owner can complete/upload evidence; previous owner's online/offline action denied.
5. Assign verifier for awaiting-verification action; only designated verifier can approve/return.
6. For each event, verify Brevo delivery log, inbox receipt, push provider acceptance, physical device push receipt/tap and target Navigation.
7. Regression: report intake, multiple corrective actions, close/reopen, email setting preferences, offline reconnection, report histories, and role isolation.

## Known limitations / follow-ups
- Real iPhone PWA acceptance, actual recipient email delivery and push receipt not yet independently exercised for transfer types. No full UAT sign-off.
- Supabase security advisor retains previously reviewed intentionally privileged RPC WARN notices, plus Auth leaked password protection unavailable on current plan. Review new notices in security UAT.
- Do NOT reset report numbers or clean test records until explicitly approved after UAT.
