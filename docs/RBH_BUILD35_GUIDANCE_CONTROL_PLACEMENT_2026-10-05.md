# RBH Build 35 - Guidance control placement

Date: 2026-10-05

## Change
- Moved **Show guidance** out of the workflow body and onto the same viewing-options row as **Read report in**.
- Removed the extra guidance-only row beneath the workflow progress/navigation area.
- The existing guidance preference behavior is unchanged and continues to sync with the profile preference.
- Regulatory warnings, required-field messages, and other mandatory safety content remain visible regardless of the guidance setting.

## Scope
Visual/layout change only. No Supabase schema, workflow status, permissions, notification, PDF, or evidence logic changes.
