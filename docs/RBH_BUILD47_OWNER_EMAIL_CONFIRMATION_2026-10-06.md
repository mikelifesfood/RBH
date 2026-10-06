# RBH Build 47 — Report Owner Email Confirmation
Date: 2026-10-06

## Purpose
Tighten Report Owner email behavior before end-to-end testing so a user cannot accidentally send handoff emails simply by changing a dropdown.

## Changes
- Step 1 Report Owner dropdown remains local until **Start investigation** is clicked.
- Step 1 helper copy now explicitly states that selecting a different owner does not send an email.
- For Step 1, a handoff email to a different Report Owner is attempted only after the report successfully advances from Review into Investigation.
- The owner-change popup now previews whether an email will be sent before anything is saved.
- Selecting the current owner disables the confirmation button and sends nothing.
- Changing ownership to yourself sends no handoff email.
- Changing ownership to another active Admin/Safety Manager requires an explicit **Confirm change & send email** click.
- After a successful reassignment the toast explicitly states whether the handoff email was sent, not sent, already processing, or failed.
- Existing Edge Function notification-event deduplication remains in place as a second server-side safeguard against duplicate sends for the same saved event.

## Normal RBH email triggers after Build 47
1. New report INSERT -> all active Admins + Safety Managers in that report's organization.
2. Step 1 -> if a different Report Owner is selected, that owner is emailed after Start investigation successfully advances the workflow.
3. Steps 2 through Close -> changing Report Owner to another person emails only the newly confirmed owner.
4. Corrective action plan activation -> each individual corrective-action owner receives their assignment email.
5. Corrective action submitted for review -> current active Report Owner receives the review email. If no valid owner exists, active Admins + Safety Managers are fallback recipients.
6. Corrective action sent back for changes -> only that corrective-action owner receives the email.
7. Verification, Continue to Close, and final Close do not send routine emails.

## Deployment
Dashboard-only update. No SQL or Edge Function redeployment is required after Build 46.
