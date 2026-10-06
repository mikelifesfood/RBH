# RBH Build 42 — Verification Stage Routing Fix
Updated: October 6, 2026

## Issue observed
A corrective action could be successfully submitted for verification and the reviewer notification email could be sent, while the incident workspace still opened the Corrective Actions > Complete Work sub-stage.

The screen could correctly state that all corrective actions were ready for review while also showing "No work needs updating here," with the Verify workspace not visible.

## Root cause
The multi-action workflow uses each current-cycle `report_corrective_actions.status` value as the authoritative state of the work. Reopened reports also retain a parent-level `reports.reopen_workflow_step` pointer.

The reopened-workflow branch of the front end gave the parent pointer precedence over the child-action statuses. The newer multi-action completion RPC updates the child action, but the parent reopen pointer can remain on Complete Work. This can leave the UI on internal stage 4 even though the child actions are already in `awaiting_verification`.

## Build 42 fix
1. For reopened reports inside Corrective Actions, the visible Plan / Complete / Verify sub-stage is now derived from the current-cycle child corrective-action statuses whenever active child actions exist.
2. Complete Work remains current while unfinished work exists or when returned work is the only work needing attention.
3. Verify becomes current when all first-pass work has been submitted and at least one review decision is pending.
4. Verify remains the final Step 3 surface after all actions are verified until the reviewer deliberately continues to Close.
5. As a defensive UI safeguard, if Complete Work is ever displayed with no actions left to complete but submitted/verified actions exist, the empty state now shows a blue **Ready for review** panel with a **Review submitted work →** button.

## What did not change
- No Supabase migration is required.
- No corrective-action RPC names or database statuses changed.
- No notification behavior changed.
- No permissions changed.
- No evidence, audit, or verification logic changed.

## Validation target
For a report with one current corrective action:
1. Submit completed work for review.
2. Confirm the action becomes `awaiting_verification`.
3. Reopen the incident workspace or refresh the page.
4. Confirm Step 3 opens **Verify** rather than **Complete Work**.
5. Confirm the submitted completion note/evidence and Verify / Send back controls are visible to an authorized reviewer.
