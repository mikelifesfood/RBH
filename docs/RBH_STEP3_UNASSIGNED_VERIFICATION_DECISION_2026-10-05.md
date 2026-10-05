# RBH Step 3 — Unassigned Verification Decision

Build 25 keeps ownership where it belongs: on the corrective action itself.

## Workflow
- Plan & Assign: each corrective action is assigned to the person responsible for completing the work.
- Complete Work: that assigned owner documents completion and submits the action for verification.
- Verify: there is no verification-owner assignment. An authorized reviewer opens the submitted action and chooses **Verify action** or **Send back for changes**.
- If one action is sent back, only that action returns to Complete Work and remains assigned to its corrective-action owner. Other verified actions stay verified.
- The record can continue to Close only after every corrective action is verified.

## UX correction
When an internal corrective-action stage changes, the page now automatically shows the stage that actually needs attention. A completed Complete Work panel should no longer remain visible while Verify is the current stage.

## Compatibility
Legacy verifier fields remain in the database for compatibility/audit history, but the current UI does not ask users to assign a verifier.
