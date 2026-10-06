# RBH Build 34 - Home attention injury outline

## Change
The Home > Needs your attention list now displays each report as a clearly separated card.

- Reports involving an injury use a red outline so they stand out immediately.
- All other reports use a light-gray outline.
- Existing priority/status badges and click behavior are unchanged.
- This is a visual-only update; no Supabase, workflow, permissions, notification, or record-status logic changed.

## Quick test
1. Open Home with at least one active injury report and one active non-injury report.
2. Confirm the injury report has a red outline.
3. Confirm the non-injury report has a light-gray outline.
4. Click each card and confirm it still opens the correct incident.
