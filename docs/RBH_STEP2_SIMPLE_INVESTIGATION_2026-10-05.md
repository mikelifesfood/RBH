# RBH Step 2 — Simplified Investigation

Build 23 updates Investigation to answer two plain-language questions:

1. **What happened?** — required. Records what the investigation determined actually occurred.
2. **Why did it happen?** — required. Uses the existing `root_cause` field and records the underlying condition or reason.
3. **Investigation evidence** — optional. Supports photos, PDF, Word, text, and common image formats, up to 5 files at a time / 10 MB each.

The primary button now says **Continue to corrective actions →** so the next destination is explicit.

## Deployment order

1. Run `supabase/RBH_STEP2_INVESTIGATION_FINDINGS_V1.sql` once in the RBH Supabase SQL editor.
2. Replace the deployed `dashboard.html` with the Build 23 version.
3. Hard refresh and test a new report through Review → Investigation → Corrective Actions.

## Compatibility

The migration backfills `investigation_findings` for previously completed investigations from the original report description so existing records do not fall backward in the workflow. A full workflow restart clears the new findings field; reopening keeps it available to confirm or update.

Investigation files are stored in the existing `report-attachments` bucket under `reports/<report-id>/investigation/g<workflow-generation>/...` and are separated in the UI/PDF from original intake attachments and corrective-action evidence.
