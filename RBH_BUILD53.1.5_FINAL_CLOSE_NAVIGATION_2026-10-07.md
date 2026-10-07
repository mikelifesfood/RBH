# RBH Build 53.1.5 — Final Close Navigation Fix

Date: October 7, 2026

## Issue
The final Close report action successfully changed the report to Closed and showed the success toast, but the user remained on the Close workflow screen.

## Fix
After the final close succeeds, the dashboard now:
1. Persists the Closed status and closure timestamp using the existing close logic.
2. Refreshes operational lists/counters.
3. Returns the user to Home.
4. Shows a green `Report #<number> closed` confirmation.

## Preserved behavior
- The closed record remains available from the Safety Inbox Closed filter.
- Closed records remain read-only unless an authorized user reopens them.
- No database migration, RLS, Edge Function, notification, permission, or workflow-schema changes were made.

## Regression check
1. Complete a report through corrective-action verification.
2. Enter Close and confirm all close checks are complete.
3. Select Close report and confirm the prompt.
4. Confirm Home opens automatically.
5. Confirm the record is removed from Needs your attention / open counts.
6. Open Safety Inbox > Closed and confirm the record opens as a finalized read-only record.
