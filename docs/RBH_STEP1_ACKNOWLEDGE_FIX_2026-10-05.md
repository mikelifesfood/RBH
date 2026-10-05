# RBH Step 1 acknowledge fix — 2026-10-05

## Issue
After the Step 1 simplification, **Continue to investigation** could show **Could not acknowledge the report**.

## Cause addressed
The simplified Step 1 had introduced a new automatic investigator-assignment update immediately before the existing status update. That ownership update was not part of the previously working Review transition and could block the acknowledgment path.

## Fix
Step 1 is now strictly triage/acknowledgment:
- **Continue to investigation** advances the report from `new` to `under_review`.
- Step 1 does **not** create, change, or clear `investigator_user_id`.
- **Close — no action needed** remains unchanged.
- Investigator/ownership behavior can be addressed in Step 2 without blocking acknowledgment.

No database schema, RLS, notification, corrective-action, evidence, or closure logic was changed.
