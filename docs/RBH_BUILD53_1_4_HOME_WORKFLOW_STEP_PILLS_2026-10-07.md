# RBH Build 53.1.4 — Home Workflow Step Pills

Date: 2026-10-07

## Purpose
Give dashboard users an immediate snapshot of where each open report sits in the four-step RBH workflow without changing the report's existing operational status.

## Home card behavior
The **Needs your attention** card keeps its existing status/attention pill (for example New, Open, Injury, Overdue, or Verify) and adds a separate workflow pill:

- Step 1 · Review
- Step 2 · Investigation
- Step 3 · Corrective Actions
- Step 4 · Close

The pill is derived from the same existing workflow progression logic used by the incident workflow. Internal corrective-action substages Plan & Assign, Complete Work, and Verify Work all display as user-facing Step 3 · Corrective Actions.

Opening a report does not automatically change its status. For example, a newly submitted report can correctly show both **New** and **Step 1 · Review** until the workflow actually advances.

## Scope
Frontend only. No database migration, Supabase change, RLS change, RPC change, role/permission change, notification change, email change, archive/export change, or workflow logic change.

## Quick validation
1. New report: verify Home shows New + Step 1 · Review.
2. Start investigation but do not finish it: verify Step 2 · Investigation.
3. Reach any corrective-action substage (Plan, Complete, or Verify): verify Step 3 · Corrective Actions.
4. Advance deliberately to Close without closing: verify Step 4 · Close.
5. Confirm Injury / Overdue / Verify attention pills still appear alongside the step pill.
6. Check a narrow/mobile viewport and confirm pills wrap below the report details rather than crowding the title.
