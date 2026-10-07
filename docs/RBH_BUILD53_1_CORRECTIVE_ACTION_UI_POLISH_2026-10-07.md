# RBH Build 53.1 — Corrective Action UI Polish

Date: 2026-10-07

## Purpose

Make the corrective-action portion of the RBH workflow more intuitive and compact without changing the underlying corrective-action data model or workflow lifecycle.

## Scope

Frontend-only update to `dashboard.html`.

No Supabase migration is required.
No Edge Function deployment is required.
No notification behavior is changed.
No role or permission behavior is changed.

## Changes

### Corrective-action decision

- The initial Yes / No decision remains explicit.
- After a selection is made, the two large decision cards collapse into a compact decision summary.
- While Step 3 remains editable, `Change decision` reopens the two decision choices.
- The No path still requires a reason and brief explanation before Continue to Close.

### Plan & Assign

- Removed redundant instructional blocks above the action cards.
- Kept all five existing required values:
  1. What needs to be fixed
  2. Assigned owner
  3. Due date
  4. Priority
  5. Type of fix
- Desktop layout now places Assigned to, Due date, and Priority on one row.
- Mobile layout stacks the same fields vertically.
- Priority changed from a dropdown to direct Low / Medium / High buttons.
- Type of fix remains the existing hierarchy-of-controls-backed value.

### Consistent action identity

Assigned actions now show the same compact summary in Plan & Assign, Complete Work, and Verify:

- Assigned to
- Due
- Priority
- Type

The same Corrective Action number, description, and status remain visible throughout the lifecycle.

### Activated plans

Once assigned, plan fields remain collapsed under View plan details / View or edit plan details. The summary remains visible so users do not have to reopen the form just to remember the owner, due date, priority, or type.

## Regression focus

Test both the Yes and No paths.

For the Yes path:

1. Select Yes and confirm the decision collapses.
2. Use Change decision and confirm the choices reopen.
3. Enter all five required fields.
4. Confirm Low / Medium / High priority buttons update the required-field progress correctly.
5. Save a draft and reopen the report.
6. Assign the action(s).
7. Confirm the action summary appears consistently in Complete Work.
8. Submit for review.
9. Confirm the same summary appears in Verify.
10. Request changes, resubmit, verify, and continue to Close.

For the No path:

1. Select No and confirm the decision collapses.
2. Enter reason and explanation.
3. Continue to Close.
4. Confirm no corrective-action child record is created.

## Build numbering

This is Build 53.1 so the previously planned Build 54 Scheduled Company Records Archive remains reserved for that future work.
