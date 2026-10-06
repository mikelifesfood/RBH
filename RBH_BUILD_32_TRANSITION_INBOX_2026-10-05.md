# RBH Build 32 - Step transition editability + Safety Inbox cleanup

## Changes

- Fixed stale disabled controls when moving directly from Review to Investigation and from Investigation to Corrective Actions without refreshing the browser.
- Editability is now synchronized every time the visible workflow panel changes, with an additional next-frame sync to prevent stale DOM state.
- Added explicit transition-time synchronization after Review, Investigation, and Plan & Assign are advanced.
- Safety Inbox now hides resolved records from the normal working inbox by default.
- Added a **Closed** quick-filter chip next to **New**.
- The Closed chip includes every resolved disposition: Closed, No action, and Duplicate.
- Existing status dropdown filters remain available for selecting an individual resolved status when needed.

## Suggested validation

1. Open a brand-new report as Admin or Safety Manager.
2. Click **Continue to investigation** without refreshing. Confirm both Investigation text fields and Investigation evidence controls are immediately editable.
3. Complete Investigation and click **Continue to corrective actions** without refreshing. Confirm the Corrective Action plan fields are immediately editable.
4. Open Safety Inbox with the **All** chip selected. Confirm Closed / No action / Duplicate records are absent.
5. Click **Closed**. Confirm resolved records appear.
6. Click **All** again. Confirm resolved records disappear.

No database migration is required for Build 32.
