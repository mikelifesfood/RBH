# RBH Build 53.1.8 - Grouped Intake Email + Injury Priority

Date: 2026-10-07

## Purpose
Improve only the initial new-report notification behavior.

## Changes
- New-report intake notification is sent as one Brevo email with all active Admin and Safety Manager recipients in the **To** line.
- Existing per-recipient `report_notification_events` audit rows are preserved for delivery/idempotency tracking.
- Later responsibility-based workflow notifications are unchanged and continue to be sent to the individual who needs to act.
- Injury intake subject changed from the ambulance treatment to:
  - `🔺 [HIGH PRIORITY – INJURY] [RBH Safety] ...`
- Injury intake messages include non-standard `X-Priority` / `X-Msmail-Priority` hints. Mail clients may choose whether to display a visible importance marker; the red-triangle subject and injury banner remain the reliable urgency treatment.
- Injury messages receive the additional `rbh-injury` Brevo tag.

## Deployment requirement
The source-control copy of `supabase/functions/notify-report/index.ts` changed. Deploy/update the `notify-report` Supabase Edge Function for this behavior to become active. No SQL migration is required.

## Recommended test
1. Ensure at least two active Admin/Safety Manager users have distinct email addresses.
2. Submit a normal test report.
3. Confirm one email arrives showing both recipients in **To**.
4. Confirm one `new_report` notification audit event exists per intended user.
5. Submit an injury test report.
6. Confirm the subject begins with `🔺 [HIGH PRIORITY – INJURY]` and the injury warning banner is present.
7. Confirm subsequent owner/action/review notifications still go to the intended individual only.
