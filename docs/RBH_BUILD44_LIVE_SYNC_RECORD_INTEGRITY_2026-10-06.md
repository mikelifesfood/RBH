# RBH Build 44 — Live Sync & Record Integrity

Date: October 6, 2026

## Purpose

Build 44 removes the need to manually refresh the dashboard for newly submitted reports, newly assigned corrective actions, and actions that become ready for review. It also adds live record presence and stale-save protection so two people can work in RBH without silently overwriting each other.

This build does **not** change the Review → Investigation → Corrective Actions → Close workflow, corrective-action permissions, notification recipients, or the Build 43 email deep links.

## Dashboard live updates

The dashboard now subscribes to an organization-scoped Supabase Realtime change feed.

When a report or corrective action is inserted or updated, RBH quietly reloads the dashboard data. This updates:

- Safety Inbox
- Home counts and attention items
- My Work
- Corrective Actions
- notification bell/count

RBH also performs a quiet 60-second fallback refresh while the tab is visible, and refreshes when a user returns to the browser tab. The browser page itself is never hard-refreshed.

## Live presence

When an authenticated user opens an incident or focused corrective action, RBH records a lightweight presence heartbeat.

Presence rules:

- A viewing user appears as an informational notice.
- Typing/changing an editable field marks the user as `editing`.
- Editing automatically falls back to viewing after 90 seconds without edit activity.
- A presence row is considered active for approximately 55 seconds without a heartbeat.
- A hidden/background browser tab stops heartbeats, so stale presence clears automatically.
- The same user is not shown to themselves.

Focused corrective actions stay granular. Two different people can work on two different corrective actions without blocking each other. A user in the full incident workspace is treated as working broadly in that report because that screen can affect the whole workflow.

## User-facing warning

If another person has the same work area open, RBH shows a banner such as:

> Jane Smith is currently editing this record.
> To avoid conflicting changes, wait until they finish or contact them before making updates.

Viewing without recent editing uses a softer informational message.

Presence is intentionally a **soft warning**, not a hard lock. A browser left open should not permanently prevent work.

## Stale-record protection

Build 44 adds a lightweight organization-scoped record-change event table. Changes to `reports` and `report_corrective_actions` record:

- report ID
- resource type and ID
- insert/update/delete event
- authenticated user who made the change when available
- event time

Before core workflow saves, the dashboard checks whether another user changed the open report/action. If so, the save is stopped and RBH displays:

> This record was updated by <user>.
> Refresh to see the latest changes before continuing.

The user must deliberately click **Refresh record** or **Refresh action**. RBH does not replace an open form automatically because that could discard unsaved typing.

Additive items such as notes/evidence are allowed to coexist because they append information rather than overwrite the same workflow fields.

## Supabase objects

Migration:

`supabase/RBH_BUILD44_LIVE_SYNC_PRESENCE_CONFLICT_V1.sql`

Adds:

- `public.rbh_record_presence`
- `public.rbh_record_change_events`
- `public.rbh_touch_record_presence(...)`
- `public.rbh_leave_record_presence(...)`
- organization-scoped RLS policies
- change-feed triggers on `reports` and `report_corrective_actions`
- `updated_at` safety columns/triggers for optimistic version checks
- Realtime publication entries for:
  - `rbh_record_change_events`
  - `rbh_record_presence`
  - `report_user_notifications`

The change-event table keeps approximately seven days of lightweight events. Presence rows older than one day are cleaned opportunistically, while the UI ignores any heartbeat older than roughly 55 seconds.

## Deployment order

1. Run `RBH_BUILD44_LIVE_SYNC_PRESENCE_CONFLICT_V1.sql` in Supabase SQL Editor.
2. Confirm the validation row returns all `true` values.
3. Replace `dashboard.html` in GitHub with the Build 44 dashboard.
4. Wait for GitHub Pages deployment.
5. Hard refresh each test browser once.

No Edge Function redeployment is required for Build 44. Keep the Build 43 email Edge Function in place.

## Recommended validation

Use two different RBH users in two browsers/private windows.

1. Leave User A on Safety Inbox.
2. Submit a new employee report from another browser.
3. Confirm User A sees the new report without manually refreshing.
4. Open the same report as User A and User B.
5. Confirm each sees the other user's presence.
6. Type in an editable field as User A.
7. Confirm User B sees User A as editing within the next heartbeat/realtime update.
8. Save a legitimate workflow change as User A.
9. Confirm User B gets the stale-record banner instead of having their open form silently replaced.
10. Attempt a workflow save as User B and confirm it is stopped.
11. Click **Refresh record** as User B and confirm the latest saved data appears.
12. Create two corrective actions and open Action #1 as User A and Action #2 as User B. Confirm the two focused action screens do not unnecessarily block each other.
13. Assign or submit a corrective action while another user is on My Work / Corrective Actions and confirm the dashboard updates without manual refresh.

## Build philosophy

- Realtime should keep lists current.
- Open forms should never be automatically replaced.
- Presence should warn, not lock.
- A stale save should stop rather than silently overwrite newer workflow data.
- Independent corrective actions should remain independently workable.
