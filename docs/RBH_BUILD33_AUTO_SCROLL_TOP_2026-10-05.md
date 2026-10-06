# RBH Build 33 — Automatic Scroll-to-Top

## Change
Workflow navigation now always opens at the top of the workspace.

This applies when:
- moving from Review to Investigation;
- moving from Investigation to Corrective Actions;
- moving between Plan & Assign, Complete Work, Verify, and Close;
- reopening an incident from Safety Inbox, My Work, Corrective Actions, a notification, or restored browser state;
- switching between the primary app views.

## Implementation safeguards
- Browser automatic scroll restoration is disabled for the dashboard so refresh/back restoration does not reopen midway down a prior page.
- The page scroll position is reset immediately and again after layout on the next animation frame / short delay.
- Keyboard focus moves to the active workflow heading without changing the top-of-page scroll position.
- Closed-record review navigation still supports jumping directly to a selected completed section; this behavior was intentionally preserved.

## No backend change
No Supabase schema, RLS, storage, workflow status, notification, or permission changes are required.

## Quick test
1. Open a report and scroll to the bottom of Review.
2. Click Continue to investigation. Confirm the workspace starts at the top.
3. Scroll to the bottom of Investigation and continue to Corrective Actions. Confirm the workspace starts at the top.
4. Leave the incident while scrolled down, reopen it from Safety Inbox, and confirm it opens at the top.
5. Refresh while an incident is open and confirm the restored incident begins at the top.
