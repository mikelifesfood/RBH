# RBH Build 30 — Step transition editability fix

## Issue fixed
When an Admin or Safety Manager advanced an incident from Review to Investigation, or from Investigation to Corrective Actions, the newly current step could still display controls as disabled until the browser was refreshed.

## Cause
The incident detail page was rendered once when the record opened. Controls for future steps were correctly disabled at that time, but after the report advanced the existing DOM controls retained those old disabled attributes even though workflow permissions had changed.

## Fix
- Synchronize step editability immediately after every workflow refresh/transition.
- Step 2 Investigation fields become editable immediately when Review advances to Investigation.
- Investigation evidence upload controls appear immediately when Step 2 becomes current.
- Step 3 Corrective Action plan cards and Add/Save controls re-render as editable immediately when Investigation advances to Corrective Actions.
- Completed prior steps remain read-only for all roles, including Admins.
- No Supabase schema, RLS, notification, PDF, or workflow-state changes were made.

## Recommended smoke test
1. Open a brand-new report as Admin or Safety Manager.
2. Click Continue to investigation.
3. Confirm What happened?, Why did it happen?, Save and close, evidence upload, and Continue to corrective actions are immediately usable without refreshing.
4. Complete both Investigation fields and click Continue to corrective actions.
5. Confirm the corrective-action plan fields, Add corrective action, Save and close, and Assign actions are immediately usable without refreshing.
6. Click back to Review and Investigation after they are complete and confirm their prior-step fields remain read-only.
