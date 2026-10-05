# RBH Step 3 Verification Simplification — 2026-10-05

## Goal
Remove the visible "Verification owner" assignment step from the corrective-action Verify stage so small-company users can simply review the completed work and either verify it or request changes.

## What changed
- Removed Verification owner dropdown, Assign to me, and Save assignment controls from corrective-action verification.
- Verification now opens directly to completed work, evidence, reviewer notes, Request changes, and Verify action.
- My Work labels no longer describe a shared/specific verifier assignment; eligible reviewers see actions that are ready for verification.
- New workflow behavior does not assign a verifier during verification.
- Historical verifier fields remain in the database for compatibility and audit history.
- If an older action/report still has a legacy verifier assignment, the app releases that assignment when an authorized reviewer takes a verification decision, preventing the old ownership model from blocking the simplified flow.
- PDF summaries no longer display a Verification owner field. The actual person who verified the work remains recorded as Verified by.

## What did not change
- No Supabase schema change is required for this UI simplification.
- Existing verification RPCs, evidence handling, notifications, audit history, and corrective-action lifecycle remain in place.
- Current permissions are unchanged: Admin/Safety Manager can verify under the existing RBH permissions model. A future Edit/Read Only permissions simplification can change that separately.

## Intended user flow
1. Corrective-action owner submits completed work.
2. Authorized company reviewer opens Verify.
3. Reviewer sees the submitted work and evidence immediately.
4. Reviewer chooses Verify action or Request changes.
5. Request changes affects only that corrective action.
