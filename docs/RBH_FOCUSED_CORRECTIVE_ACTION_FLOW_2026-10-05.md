# RBH Focused Corrective Action Flow — 2026-10-05

## Goal
Make the corrective-action workflow easier for nontechnical users by showing only the stage that currently needs attention.

## Visible flow
The main workflow remains:

1. Review
2. Investigation
3. Corrective Actions
4. Close

Corrective Actions still uses the existing internal Plan / Complete / Verify workflow and database statuses, but the UI shows only one of those stages at a time.

## Corrective Action stage behavior

### Plan & Assign
- Only Plan & Assign is shown.
- Users complete the required fields for every action.
- Assign Actions advances to Complete Work.

### Complete Work
- Only actions that still need completion are shown.
- Once an action is submitted for verification it disappears from this stage so the user can focus on unfinished work.
- Verification does not open until all first-pass corrective actions are ready for review.

### Verify
- Only actions currently waiting for a verification decision are shown during an active workflow.
- Already verified actions are hidden from the active work area and counted in the summary.
- Reviewers may Verify Action or Request Changes on each action.

### Targeted Request Changes
If one action out of several needs more work:
- Only that action is returned to its assigned owner.
- Other verified actions remain verified.
- Other actions still awaiting review may continue to be reviewed before the workflow leaves Verify.
- When no verification decisions remain and one or more actions were returned, the UI moves back to Complete Work and shows only the returned actions.
- After the returned actions are resubmitted, the UI returns to Verify and shows only those actions still awaiting a decision.

This avoids restarting or reopening unrelated corrective actions.

## Backend impact
No database schema, RPC name, notification function, permission rule, Supabase policy, or storage behavior was intentionally changed in this update. This is a workflow-presentation and stage-selection update using the existing per-action statuses.

## Validation completed
- Inline JavaScript syntax checked with Node.js.
- ZIP integrity checked after packaging.

## Recommended smoke test
Use a report with three corrective actions:
1. Assign all three.
2. Submit Action 1 and confirm it disappears while Actions 2 and 3 remain in Complete Work.
3. Submit Actions 2 and 3 and confirm the UI moves to Verify.
4. Verify Action 1.
5. Request changes on Action 2.
6. Confirm Action 3 can still be reviewed.
7. After Action 3 is verified, confirm the UI moves to Complete Work and only Action 2 is shown.
8. Resubmit Action 2 and confirm the UI returns to Verify showing only Action 2.
9. Verify Action 2 and continue to Close.
