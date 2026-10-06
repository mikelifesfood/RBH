# RBH Build 31 — Final Step 3 gate + PDF export fix

## Fixes in this build

1. Final corrective-action review remains in Step 3 after leaving/reopening the record.
   - When every corrective action is verified, Step 4 Close stays gray.
   - The reviewer must explicitly click **All actions verified — Continue to Close** to enter the Close screen.
   - Leaving the record before final closure returns the user to the final Step 3 review rather than automatically opening Close.

2. Actual record closure now asks for confirmation before writing `status = closed`.
   - This protects against accidental closure while navigating the final workflow screens.

3. Corrective-action status badges now use the live child corrective actions instead of the older report-level `action_status` field when multi-action workflow data exists.
   - This prevents combinations such as an old `In progress` badge when all child actions are already verified.

4. PDF export fix.
   - Removed a leftover call to an undefined `titleCase()` helper in the multi-corrective-action PDF path.
   - That error was triggered when a corrective action had a priority such as Low/Medium/High and caused the entire PDF generation to fail.
   - PDF error messages temporarily include a short technical reason if another unexpected PDF issue occurs, which will make any remaining test failure easier to isolate.
   - The PDF workflow bar also keeps Close gray while the final Step 3 review is still pending.

## No database migration required

This build changes dashboard behavior only. No SQL or Supabase schema update is required.

## Recommended test

1. Create a report and progress through Review and Investigation without refreshing.
2. Create at least two corrective actions with priorities.
3. Complete and verify both actions.
4. Confirm the final Step 3 review lists all actions and Step 4 Close is gray.
5. Leave the incident and reopen it. It should return to the final Step 3 review, not Close.
6. Click **All actions verified — Continue to Close**. Close should become active.
7. Click **Close record** and confirm the browser confirmation prompt appears before the record is actually closed.
8. Generate the PDF before and after closure.
