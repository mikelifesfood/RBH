# RBH Build 53.1.7 - Public Reference Guide Link

Date: 2026-10-07

## Purpose

Provide a full written reference option for users who prefer documentation in addition to the desktop Help Coach.

## Changes

- Added `docs/RBH_Safety_Workflow_Reference_Guide.pdf` as a public-safe, sanitized workflow guide.
- Sanitized names, email addresses, and test-specific incident details in screenshots using generic example data.
- Added a **Full Reference Guide** link at the bottom of the desktop `?` Help Coach home screen.
- The guide opens in a new browser tab using a relative URL so the same repository structure can be reused for future customer deployments.
- Existing short Help Coach walkthroughs remain unchanged.

## Security / privacy

- The public PDF contains sanitized example identities and sample incident data.
- No production credentials, Supabase secrets, customer passwords, or private attachment files are included in the PDF.
- The PDF is intentionally a static public documentation asset. Do not place customer-confidential records in this file.

## Technical scope

Frontend/documentation only. No database migration, Supabase function, RLS, storage-policy, notification, role, workflow, or archive changes are required.
