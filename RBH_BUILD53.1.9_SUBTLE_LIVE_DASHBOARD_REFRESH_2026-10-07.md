# RBH Build 53.1.9 - Subtle Live Dashboard Refresh

Date: 2026-10-07

## Purpose
Keep the existing Supabase realtime synchronization and 60-second fallback safety check while eliminating unnecessary Home-page redraws that could cause cards and activity rows to visibly jump.

## Changes
- Silent live/fallback report checks now calculate a data fingerprint before repainting dashboard views.
- If report, corrective-action, and attachment data are unchanged, the dashboard is not re-rendered.
- Home summary tiles skip DOM replacement when their displayed counts are unchanged.
- Needs your attention skips DOM replacement when the displayed report snapshot is unchanged.
- Recent activity no longer replaces an existing list with a temporary Loading state during background refreshes.
- Recent activity is replaced only when the actual activity rows change.

## Preserved behavior
- Realtime database change subscription remains enabled.
- 60-second fallback synchronization remains enabled.
- Notification polling/realtime behavior is unchanged.
- Presence, stale-record protection, workflow behavior, permissions, email logic, and database structure are unchanged.

## Suggested test
1. Leave Home open for at least 2-3 minutes with no changes. The screen should remain visually still.
2. Submit or update a report from another account/browser. The Home data should update shortly after the realtime event without a full-page jump.
3. Confirm new report counts, Needs your attention, Recent activity, My Work, and inbox data remain current.
