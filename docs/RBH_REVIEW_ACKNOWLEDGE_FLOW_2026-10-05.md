# RBH Review Step Simplification — 2026-10-05

Step 1 now focuses only on the initial review decision.

- Removed the visible Case owner / investigator assignment card from Review.
- Kept the serious-event / Cal/OSHA screening in Review when applicable.
- Added two explicit outcomes at the bottom of Review:
  - **Acknowledge & start investigation**
  - **Close report** with the existing documented closure flow.
- When an Admin or Safety Manager acknowledges an unassigned report, the app quietly assigns that user as the investigator behind the scenes so Investigation has an owner without adding another decision to Review.
- Existing backend fields, closure modal, audit history, notifications, Supabase schema, and corrective-action workflow were not changed.

Next review target: Step 2 — Investigation.
