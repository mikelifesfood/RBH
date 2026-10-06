# RBH Build 39 — Corrective-Action Header Summary Logic

Date: October 6, 2026

## Purpose
Make the report header and Safety Inbox summarize the current corrective-action work instead of relying on the legacy single-action report fields.

## What changed
- A corrective action due today is now **Due today**, not Overdue.
- A corrective action becomes **Overdue** only when its due date is before the current local calendar date.
- For reports with multiple active corrective actions, the report-level due state is calculated from the current workflow cycle.
  - Any overdue open action makes the report Overdue.
  - Otherwise, any open action due today makes the report Due today.
  - Otherwise, the nearest open action due date is used for sorting and supporting text.
- The report-level priority is now the highest priority among the current unverified corrective actions.
  - High beats Medium; Medium beats Low.
  - Verified actions no longer keep an old higher-priority pill on the report.
  - Low priority remains on the individual action but is intentionally omitted from the report header to reduce noise.
- The legacy parent **Assigned** status pill is hidden when current-cycle corrective actions exist, because the more useful action-state pill (In progress, Ready for review, Changes requested, or Verified) already explains what is happening.
- Safety Inbox Overdue filtering, Priority sorting, Due date sorting, attention ranking, and overdue metrics now use the same aggregate logic as the report header.
- Individual corrective-action overdue checks now use calendar-day logic so an action due today does not become overdue at midnight.
- Header/list summaries refresh after corrective-action plan/status updates so the aggregate pills reflect the current child actions without requiring a browser refresh.

## Compatibility
If a legacy report has no active child rows in `report_corrective_actions`, the UI falls back to the existing report-level `due_date` and `priority` values. This preserves compatibility with older records.

## Backend impact
None. No SQL, schema, RLS, RPC, Edge Function, notification, or database change is required.

## Validation examples
1. One High action due today -> `Due today | High priority | In progress`.
2. One High action overdue + one Medium action due later -> `Overdue | High priority | In progress`.
3. High action verified + Medium action still open -> `Medium priority | In progress` (High no longer controls the report summary).
4. Only Low open actions -> no report-level priority pill; individual action cards still show Low.
5. Current child actions present while parent report status is `assigned` -> do not show the redundant `Assigned` pill.
