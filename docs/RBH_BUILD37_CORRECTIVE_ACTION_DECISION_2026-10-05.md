# RBH Safety Build 37 — Corrective-Action Decision

## Purpose
Step 3 now starts with a documented decision rather than assuming every investigation must create a new corrective-action assignment.

The reviewer is asked:

**Does anything still need to be corrected?**

### Yes — corrective action is needed
Use this when something still needs to be fixed, changed, repaired, trained, communicated, guarded, or otherwise addressed.

Examples shown in the UI:
- A damaged ladder still needs to be removed or replaced.
- The investigation found a training or work-practice gap that still needs to be corrected.

Choosing Yes opens the existing Plan & Assign → Complete Work → Verify workflow.

### No — no additional corrective action needed
This is a documented determination, not a Skip button.

Examples shown in the UI:
- A cone was immediately repositioned and the investigation found no underlying hazard left to address.
- The issue is already covered by an existing active corrective action and no new work is needed.

The reviewer must select a reason and enter a brief explanation before continuing.

Available reasons:
- Corrected immediately
- Investigation found no unsafe condition
- Already covered by an existing corrective action
- Duplicate / previously addressed
- Other

After the decision is saved, Step 3 is complete and the record moves to Step 4 Close. The record is **not automatically closed**.

## Safety / audit rules
- An activated corrective action can never be silently converted into No additional action needed.
- Unsaved/draft Step 3 action rows are retired when No additional action is documented.
- The decision, reason, explanation, timestamp, and actor are stored on the report and appear in Activity/PDF/CSV.
- Restarting or reopening the workflow clears the active Step 3 decision so it must be made again for the new cycle; prior history remains preserved.
- The server-side Close guard now supports both valid paths:
  - Corrective action required → every active current-cycle action must be verified.
  - No additional action required → the documented reason/explanation must exist and there must be no active corrective-action rows.

## Deployment order
1. Confirm Build 36 SQL completed successfully.
2. Run `supabase/RBH_BUILD37_CORRECTIVE_ACTION_DECISION_V1.sql` in Supabase SQL Editor.
3. Confirm the validation row at the bottom returns `true` for every boolean field.
4. Deploy the Build 37 GitHub files.
5. Hard refresh the dashboard.

## Recommended QA
### Scenario A — corrective action required
1. Submit a report and complete Review and Investigation.
2. In Step 3 choose **Yes — corrective action is needed**.
3. Confirm Plan & Assign appears.
4. Create, assign, complete, and verify at least one corrective action.
5. Confirm Close remains unavailable until all actions are verified.

### Scenario B — corrected immediately
1. Complete Review and Investigation.
2. In Step 3 choose **No — no additional corrective action needed**.
3. Select **Corrected immediately**.
4. Enter a brief explanation.
5. Continue to Close.
6. Confirm Step 4 opens, but the report is not automatically closed.
7. Close the record and confirm the decision is visible in Activity/PDF/CSV.

### Scenario C — prevent accidental No
1. Choose Yes and activate/assign a corrective action.
2. Return to Step 3 if possible.
3. Confirm the app/server will not silently switch the record to No additional action while an activated corrective action exists.

### Scenario D — restart/reopen
1. Complete a report using either Step 3 path.
2. Restart or reopen it.
3. Confirm Step 3 requires a fresh decision for the new cycle.
