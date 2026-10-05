# RBH Build 26 — Focused Personal Corrective-Action Workspace

Date: 2026-10-05

## Goal
Make corrective-action work difficult to complete in the wrong place. An assignee should not have to open the entire incident workflow and hunt for Action #3 among Actions #1 and #2.

## New behavior
- Clicking a corrective action in **My Work** opens only that corrective action.
- Clicking a corrective action in the **Corrective Actions** workspace also opens the same focused single-action view.
- The focused page shows the assigned work, owner, due date, priority, control type, current completion note, evidence, and any reviewer change request.
- The assigned owner can update the completion note, add/remove evidence while the action is active, and submit/resubmit that one action.
- Awaiting-verification actions show the submitted work and evidence. Authorized reviewers can verify or send the single action back from the focused view; no verifier assignment is required.
- Verified actions are read-only.
- A secondary **View incident details** button remains available for context, but the full incident is no longer the default destination.
- Returned actions remain directly accessible to their owner even when another action on the same incident is still awaiting verification.
- The full incident workflow now synchronizes refreshed child-action rows back into the My Work / Corrective Actions in-memory lists immediately, so a send-back no longer requires a manual page refresh to appear in the owner queue.

## Data behavior
This is not a duplicate task record. The focused page uses the existing `report_corrective_actions` child row and existing corrective-action evidence records. Submitting, resubmitting, verifying, or requesting changes therefore updates the same data shown in the main incident workflow.

## Database changes
None. Build 26 uses the existing child-action RPCs and evidence Edge Function.

## Recommended test
1. Create one incident with three corrective actions assigned to the same test user.
2. Open My Work and select Action #3. Confirm only Action #3 appears.
3. Enter completion information, attach evidence, and submit it.
4. Confirm Action #3 leaves the active owner queue and appears for verification.
5. Send Action #3 back while Action #2 remains awaiting verification.
6. Return to the assignee's My Work. Confirm Action #3 is visible as Changes requested and opens directly to Action #3.
7. Resubmit it and verify that the main incident workflow shows the same completion note, evidence, and status.
