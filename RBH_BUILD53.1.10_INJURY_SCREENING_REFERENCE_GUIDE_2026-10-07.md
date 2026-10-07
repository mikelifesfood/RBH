# RBH Build 53.1.10 — Injury Screening Reference Guide Update

Date: 2026-10-07

## Purpose
Update the public workflow reference guide so Step 1 accurately documents the Injury / illness regulatory-screening workflow.

## Guide changes
- Added the Injury / illness Step 1 regulatory-screening screenshot.
- Documented all Screening Result choices:
  - No — serious-event criteria are not currently identified.
  - Unsure — more information is needed.
  - Yes — possible serious event; escalate now.
- Documented which conditional fields appear for each choice.
- Clarified that company-awareness date/time is required for Unsure and Yes.
- Clarified that the Cal/OSHA notification date/time appears after the notification checkbox is selected.
- Clarified date/time validation and the current-time fallback when notification is checked without a timestamp.
- Clarified that unresolved Unsure/Yes follow-up remains visible in later workflow steps.
- Clarified that final closure is blocked until injury regulatory follow-up is resolved.
- Updated intake-email documentation for grouped Admin/Safety Manager recipients and the high-priority injury subject.

## Application impact
Documentation only. No dashboard workflow, database, RPC, RLS, permissions, notifications, Edge Functions, or archive logic changed.

## Deployment
Replace the repository files with this full ZIP. The existing Help Coach link remains unchanged and continues to open:

`docs/RBH_Safety_Workflow_Reference_Guide.pdf`
