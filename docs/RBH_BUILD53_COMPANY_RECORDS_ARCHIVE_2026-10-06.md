# RBH Build 53 — Company Records Archive

Date: 2026-10-06

## Purpose

Give RBH an independent, customer-controlled retention/export copy while legal and compliance retention policy work is being developed.

## Admin experience

The Admin page now includes **Company records archive** with an **Export company records (.zip)** button.

The export is Admin-only and confirms before generation because the package can contain sensitive injury, personal, and safety information.

## ZIP contents

The archive contains a top-level `RBH_Company_Records` folder with:

- `Reports.csv`
- `Corrective_Actions.csv`
- `Notes.csv`
- `Report_Audit.csv`
- `Corrective_Action_Audit.csv`
- `Attachments.csv`
- `Users.csv`
- `Admin_Activity.csv`
- `README.txt`
- `Reports/Report_XXXXXX/Report_XXXXXX.pdf`
- `Reports/Report_XXXXXX/Attachments/...`

CSV files are UTF-8 and open directly in Excel.

## Attachments

Original source files are retrieved from the `report-attachments` bucket using temporary signed URLs and copied into the ZIP. The attachment manifest records:

- report reference
- attachment ID
- corrective-action ID when applicable
- source classification
- original file name
- storage path
- export path
- recorded and exported file size
- export status
- SHA-256 hash

Missing or unavailable files are never silently omitted. A `.MISSING.txt` placeholder and manifest status identify the problem.

## PDFs

Each report receives a readable archive PDF containing the report, workflow/regulatory fields, investigation, corrective actions, closure information, notes, attachment index, and activity summary.

The PDF intentionally states that it is an archive copy and is not itself an OSHA 300/300A/301 filing. Original attachment files remain separate in the ZIP.

## Scope

The archive includes all report states visible to the Admin, not only closed reports.

Passwords, authentication credentials, application secrets, and Supabase keys are never exported.

## Deployment

No SQL migration or Edge Function redeploy is required for Build 53.

Deploy the updated `dashboard.html`.

Build 52 SQL remains part of the consolidated repository because it is already applied to the RBH database.

The previously deployed `admin-manage-user` Edge Function source has also been restored to source control in this consolidated package.
