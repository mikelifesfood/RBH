# RBH Build 28 - Final Verification Visibility + Read-Only Completed Steps

## Step 3 final verification
- The Verify stage now keeps every current-cycle corrective action visible.
- Awaiting actions retain Verify and Send back for changes controls.
- Verified actions remain listed with their verification result and are read-only.
- Returned actions remain visible for context while other awaiting actions are being reviewed.
- When all actions are verified, the full list remains visible until the reviewer explicitly selects **All actions verified — Continue to Close**.
- Step 4 Close remains pending until that explicit transition.

## Completed workflow stages
- Completed stages are read-only for all roles, including Admin.
- Prior steps remain viewable from the workflow bar for reporting and audit review.
- Investigation text and Investigation evidence cannot be changed once Investigation is complete.
- Corrective-action evidence cannot be changed while an action is awaiting verification or after it is verified. A reviewer must send the action back before the owner can change completion evidence.
- A completed-step notice tells users to add a Note for minor clarification or restart the workflow for a material correction.

## Data / deployment
- No Supabase migration is required.
- No database schema, RLS, notification, storage, or RPC changes were made.
