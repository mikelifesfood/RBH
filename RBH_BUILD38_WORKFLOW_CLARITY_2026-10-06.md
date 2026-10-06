# RBH Build 38 — Workflow Clarity Pass

Date: October 6, 2026

## Scope
Presentation and wording only. No SQL, database schema, RLS, storage, RPC, workflow-state, or notification behavior changes were introduced.

## Changes
- Moved optional reporter contact information to the end of the employee reporting form.
- Renamed the Step 1 actions to distinguish early closure from final report closure.
- Replaced ambiguous “Save and close” wording with “Save draft & return home.”
- Renamed “Continue to corrective actions” to “Finish investigation.”
- Simplified the Step 3 Yes/No decision wording.
- Changed the corrective-action “Control type” UI label to “Type of fix” while preserving the existing database field/value set.
- Changed owner-facing “Submit for verification” wording to “Send for review.”
- Changed the visible awaiting-verification status to “Ready for review” while preserving the underlying status key `awaiting_verification`.
- Changed reviewer action text to “Verify as complete.”
- Standardized final user-facing closure wording around “Close report.”
- Collapsed Notes & activity history by default.
- Moved Restart/Reopen recovery actions under “More actions.”

## Investigator assignment
The investigator assignment capability has NOT been removed. Existing fields, permissions, notification logic, handlers, and styles remain in place.

The visible Step 1 assignment card is controlled by:

`ENABLE_INVESTIGATOR_ASSIGNMENT_UI=false`

RBH keeps this false. A future deployment that uses a separate investigator can set it to true to restore the existing assignment card without changing the database model.

## Validation
Run the existing Build 37 two-path workflow test after deployment. No backend migration is required for Build 38.
