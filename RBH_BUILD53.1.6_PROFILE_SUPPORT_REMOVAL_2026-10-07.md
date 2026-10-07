# RBH Build 53.1.6 — Profile Support Removal

Date: October 7, 2026

## Product decision
Customer users should not submit general product questions, suggestions, or update requests directly from individual profile accounts. Account-level communication should be coordinated through the person responsible for the customer's TeamWorkt Safety account.

## Changes
- Removed the **Support** tab from **My Profile**.
- Removed the in-app **Feedback & support** submission form and Quick help panel that lived under that tab.
- Removed the browser-side feedback submission handler used by that form.
- Preserved **Profile** and **Security** without behavior changes.
- Preserved the existing desktop **Help Coach** for workflow guidance.
- Preserved previously submitted `app_feedback` records and the existing Admin/Platform historical feedback viewer; no records were deleted.

## Technical scope
Frontend-only cleanup. No database migration, RLS, RPC, Edge Function, notification, role, report-workflow, or records-archive changes.

## Regression check
1. Open **My Profile**.
2. Confirm only **Profile** and **Security** tabs are present.
3. Confirm profile fields save normally.
4. Confirm password change/reset and sign-out controls still work.
5. Confirm the desktop Help Coach still opens normally.
