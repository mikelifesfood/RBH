# RBH Safety — Simplified Workflow + Demo Look (2026-10-05)

## Scope

Presentation-only update to the management dashboard. The simplified workflow remains:

1. Review
2. Investigation
3. Corrective Actions (Plan & Assign → Complete Work → Verify Work)
4. Close

The dashboard now uses the visual system from `RBHDemoSite-main`:

- flat black sidebar and navigation chrome
- flat RBH crimson brand accents
- Archivo typography
- white / light-gray ruled panels instead of gradients and stacked card effects
- black current workflow step, green completed state, red blocked / needs-attention state, gray future state
- cleaner form controls, buttons, status pills, task lists, and incident workspace
- no dark-mode visual styling

## Simplified corrective-action workspace

The grouped corrective-action experience remains intact. Additional bridge styling was added so the newer grouped Step 3 workspace matches the demo design system:

- Plan, Complete, and Verify stay grouped inside Corrective Actions
- left-side lifecycle rules remain, using the demo state colors
- field-completion indicators remain visible
- missing-field prompts remain visible
- completed / waiting / changes-requested / verified states use the demo visual language
- closed-record review remains compact

## What did NOT change

- Supabase configuration
- SQL or database schema
- RLS policies
- Edge Functions
- notifications
- workflow JavaScript
- permissions
- element IDs
- forms or saved values
- record lifecycle logic
- PDFs / exports

The `<body>` and inline JavaScript in `dashboard.html` are byte-for-byte unchanged from the simplified-workflow source. Only the dashboard presentation layer in `<head>` / `<style>` was changed.

## Deployment

Replace `dashboard.html` in GitHub with this version.

No SQL or Supabase deployment is required.

## Recommended smoke test

1. Sign in and verify the Home, My Work, Safety Inbox, Corrective Actions, Analytics, and Admin screens load normally.
2. Open a new report and verify the top process shows Review → Investigation → Corrective Actions → Close.
3. Complete Review and Investigation.
4. In Corrective Actions, confirm Plan & Assign, Complete Work, and Verify Work stay grouped and the active stage is visually obvious.
5. Confirm missing required fields are clearly identified.
6. Confirm a submitted action moves visually from completion to verification.
7. Verify / request changes and confirm the status treatment changes correctly.
8. Close the report and confirm closed-record review stays readable and compact.
9. Repeat the workflow on a phone-sized screen.
