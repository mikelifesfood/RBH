# RBH Safety Build 29 - PDF Export Reliability

Date: 2026-10-05

## Purpose
Build 29 hardens the existing incident PDF export so a supporting service or attachment problem does not unnecessarily prevent the report summary from downloading.

## Changes
- PDF export no longer calls the translation service when the requested PDF language is the same as the report's original language.
- The attachment appendix is now best-effort. If the appendix library is unavailable, the report summary still downloads and the user receives a warning.
- Legacy/incomplete attachment metadata no longer blocks the PDF summary.
- If one signed attachment URL cannot be prepared or a stored file cannot be loaded, that attachment receives an unavailable placeholder in the appendix instead of aborting the entire export.
- Attachment names and appendix text are normalized before being written with PDF-Lib's standard fonts to prevent unsupported filename characters from crashing the export.
- If the entire attachment appendix fails unexpectedly, the report summary PDF still downloads and the user receives a warning.

## Unchanged
- Report data and workflow behavior
- Supabase schema/RLS
- Corrective-action logic
- Investigation logic
- Permissions
- Notifications
- Stored evidence and attachments

## Validation
- dashboard inline JavaScript syntax: PASS
- extracted script_3.js syntax: PASS
- ZIP integrity: PASS
