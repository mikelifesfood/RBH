# RBH Simplified Workflow Update — 2026-10-05

## Goal
Make the incident workflow easier for nontechnical users while preserving the existing Supabase workflow, audit history, notifications, and corrective-action state transitions.

## Visible workflow
The dashboard now presents four user-facing stages:

1. Review
2. Investigation
3. Corrective Actions
4. Close

The existing internal workflow steps for corrective actions are preserved and grouped inside the visible **Corrective Actions** stage:

- Plan & assign
- Complete work
- Verify work

No database schema, RLS, trigger, Edge Function, notification, or role/permission change is included in this update.

## User-experience changes
- A single Corrective Actions workspace follows each action through planning, completion, and verification.
- Required plan fields show a live completion count and a plain-language "Still needed" message.
- Completed/locked plan information collapses into a compact summary instead of repeating a full form.
- Complete work shows only actions that still need owner updates.
- Verify work shows submitted or verified actions instead of duplicating actions that are still being completed.
- Status rails and text labels distinguish current, completed, changes-requested, and upcoming work.
- Closed-record review is more compact and avoids repeating the same corrective-action information in multiple sections.
- PDF workflow progress now matches the four-stage user-facing workflow while retaining 3A/3B/3C corrective-action detail sections.

## Intentionally deferred
Role simplification (for example, Edit vs Read Only) is intentionally deferred to the next phase so this usability update does not alter production permissions.

## Recommended deployment smoke test
1. Open a new record and confirm the top workflow shows Review, Investigation, Corrective Actions, Close.
2. Complete Review and confirm the user is guided to Investigation.
3. Complete Investigation and confirm Corrective Actions opens at Plan & assign.
4. Create two corrective actions and verify missing required fields are identified clearly.
5. Assign both actions and confirm the plan becomes a compact summary.
6. Complete one action and submit it for verification while leaving the second action open; confirm the submitted action appears under Verify work and the unfinished action remains under Complete work.
7. Request changes on one submitted action; confirm the action returns to Complete work with a clear Changes requested state.
8. Resubmit and verify all actions; confirm Close becomes available only after every action is verified.
9. Close the record and confirm the closed review is read-only, compact, and still shows the complete lifecycle/evidence history.
10. Export the PDF and confirm its workflow bar shows four stages and its corrective-action detail remains complete.
