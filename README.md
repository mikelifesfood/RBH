# RBH Insulation Safety Application

RBH is the current live blueprint for the TeamWorkt Safety product. The repository contains the public employee reporting form, authenticated management dashboard, platform/admin pages, Supabase database reference scripts, and source-control copies of the deployed Supabase Edge Functions.

## Current build status

Current production candidate: **Build 53.1.11 - Final UX Cleanup** (2026-10-07).

The user-facing management flow is intentionally four steps:

1. Review
2. Investigation
3. Corrective Actions
   - Plan & Assign
   - Complete Work
   - Verify / Request Changes
4. Close

Current ownership model:

- Report Owner: one active Admin or Safety Manager accountable for the current report cycle
- Corrective Action Owner: assigned per corrective action and responsible for completing that specific action
- Verification: authorized Admins / Safety Managers review submitted corrective actions; no separate verifier assignment is required in the normal UI
- Closure: Admin / Safety Manager after all required workflow and regulatory follow-up is complete

The application also includes injury/Cal/OSHA screening, corrective-action evidence, audit/activity history, PDF/CSV output, company-records ZIP export, English/Spanish viewer preferences, Brevo transactional email notifications, database-backed in-app notifications, live presence/conflict protection, the desktop Help Coach, and a full public-safe PDF reference guide.

## Main application files

- `index.html` - public employee safety reporting form
- `dashboard.html` - authenticated RBH management dashboard
- `platform/index.html` - platform/admin interface retained from the current RBH build
- `logo.png` - RBH logo asset

Executable historical HTML copies have been removed from the published repository. Git history remains the archive for prior versions.

## Supabase source control

See `supabase/README.md`.

Recent database changes and canonical Edge Function source are now captured under `supabase/` so the GitHub repository more accurately represents what is deployed in RBH.

**Important:** The current SQL collection is not yet the final clean, from-zero customer migration set. A dedicated production-security and clone-readiness phase will consolidate the schema, RLS, Storage policies, functions, triggers, Auth configuration, secrets checklist, backup/retention controls, and customer isolation requirements into a sanitized TeamWorkt Safety master template.

## Current deployed Edge Functions represented in this repo

- `supabase/functions/notify-report/index.ts`
- `supabase/functions/send-action-assignment-email/index.ts`
- `supabase/functions/translate-report/index.ts`
- `supabase/functions/admin-manage-user/index.ts`

Secrets stay in Supabase and must never be committed to GitHub.

## Deployment context

The current RBH frontend is hosted through GitHub Pages. There is no current Cloudflare or Vercel deployment attached to this RBH build.

Current dashboard URL:

`https://mikelifesfood.github.io/RBH/dashboard.html`

## Current product phase

RBH is in final user-testing / production-candidate cleanup. Avoid adding unrelated features before the current four-step workflow, role permissions, notifications, exports, and regulatory-screening paths complete regression testing.

**Build 54** remains reserved for the planned Scheduled Company Records Archive and has not been built.

## Build 23 - simplified Investigation

Before deploying this dashboard version, run `supabase/RBH_STEP2_INVESTIGATION_FINDINGS_V1.sql` once in Supabase. Step 2 then uses two required plain-language questions (`What happened?` and `Why did it happen?`) plus optional investigation evidence. See `docs/RBH_STEP2_SIMPLE_INVESTIGATION_2026-10-05.md`.

## Build 25 — 2026-10-05
Step 3 Verify was simplified for small-company use. The visible Verification owner assignment controls were removed. Authorized reviewers now go directly from completed work/evidence to Verify or Request changes. See `docs/RBH_STEP3_VERIFICATION_SIMPLIFICATION_2026-10-05.md`.

## Build 26 — focused personal corrective-action work — 2026-10-05

Corrective-action cards opened from **My Work** or **Corrective Actions** now open a single-action workspace instead of the full incident workflow. The focused page writes to the same `report_corrective_actions` row and corrective-action evidence records used by the incident workflow. Returned actions remain visible to their assigned owner even while other actions on the same incident are still in verification. No database migration is required. See `docs/RBH_BUILD26_FOCUSED_PERSONAL_ACTION_WORKSPACE_2026-10-05.md`.


## Build 27 UI refinement
- Step 4 Close stays gray while the reviewer remains in Step 3 after all corrective actions are verified.
- Close becomes active only after **All actions verified - Continue to Close** is selected.

## Build 28 - Final verification visibility + completed-step locking (2026-10-05)

- Step 3 Verify now keeps every current-cycle corrective action visible, including actions already verified, so the reviewer can see the complete corrective-action set before continuing to Close.
- Verified actions remain read-only and display their verification result; awaiting actions retain Verify / Send back controls.
- Evidence is read-only once an action has been submitted for verification. If evidence needs to change, the reviewer sends that action back to its owner.
- Completed workflow stages are read-only for every role, including Admin. Prior stages remain viewable, but their fields and workflow controls cannot be edited.
- Completed-stage guidance directs users to add a note for a minor clarification or restart the workflow for a material correction.
- No Supabase migration is required for this build.

## Build 50 — Desktop Help Coach — 2026-10-06

The authenticated dashboard now includes a desktop-only, role-aware and page-aware Help Coach opened from a fixed `?` button. It provides curated task walkthroughs and optional `Show me` highlighting of live controls. The feature is intentionally hidden on mobile/coarse-pointer layouts and requires no database or Edge Function changes. See `docs/RBH_BUILD50_DESKTOP_HELP_COACH_2026-10-06.md`.


## Build 51 — Intake Safety & Hardening — 2026-10-06

- Injury / illness is now an explicit required first question with no default answer.
- Injury / illness reports are automatically classified as `Injury / illness`; non-injury users then choose the applicable concern type.
- Emergency copy now directs workers to call 911 / their supervisor first, then report once safe.
- Photo controls are split into `Take photo` and `Choose photo/file`; large supported photos are resized in-browser and all attachments are capped at 10 MB each.
- `When did you notice it?` starts with the device's current local date/time and tells the user to adjust it if needed.
- Public intake includes a low-friction honeypot. A true server-side anonymous rate limit remains intentionally deferred until the public intake is routed through a controlled server/Edge Function path.
- Executable historical `index` / `dashboard` pages were removed from the published source.
- Supabase JS CDN imports are pinned to `2.117.2`.
- New-report injury email language now says qualifying serious events must be reported immediately/as soon as practically possible, with the eight-hour outer limit stated as a limit rather than a waiting period.
- Offline auto-submit was deliberately not added.

See `docs/RBH_BUILD51_INTAKE_SAFETY_HARDENING_2026-10-06.md`.


## Build 52 — Admin role update guard compatibility — 2026-10-06

The `profiles` security trigger now permits trusted Supabase `service_role` backend updates while preserving the Admin-only guard for normal authenticated browser users. This resolves the `ROLE_UPDATE_FAILED / ADMIN_REQUIRED` conflict seen when `admin-manage-user` attempted to change another user's role. See `supabase/RBH_BUILD52_PROFILE_SECURITY_GUARD_SERVICE_ROLE_FIX.sql`.

## Build 53 — Company Records Archive — 2026-10-06

The Admin page now includes **Export company records (.zip)**. The archive is designed as an independent retention copy for the customer and includes:

- Excel-compatible CSV exports for reports, corrective actions, notes, audit history, attachments, user profiles, and Admin activity.
- One readable PDF copy for each report.
- Original report, investigation, and corrective-action evidence files.
- An attachment manifest with archive path, export status, file size, and SHA-256 hash.
- A README describing the package, counts, warnings, and security/retention limitations.

The export is Admin-only, confirms before generating because the ZIP can contain sensitive information, and records missing/unavailable attachments in the manifest instead of silently omitting them. No database migration or Edge Function deployment is required for Build 53.

## Build 53.1.3 — Corrective Action Final Alignment Polish — 2026-10-07

Final UI-only alignment pass for the corrective-action workflow. Standardized card header alignment, progress/status/remove pill heights, compact field spacing, required-message alignment, completion/verification card spacing, mobile card padding, and the Add another corrective action control. No database, RPC, RLS, notification, archive, permission, or workflow behavior changed. Native browser date-picker popups remain browser/OS controlled.

## Build 53.1.4 — Home Workflow Step Pills — 2026-10-07

Home **Needs your attention** cards now show a separate workflow-position pill in addition to the existing attention/status pill. The pill uses the existing four-step user-facing workflow and displays **Step 1 · Review**, **Step 2 · Investigation**, **Step 3 · Corrective Actions**, or **Step 4 · Close**. Corrective-action Plan, Complete Work, and Verify substages all intentionally remain grouped as Step 3. This is frontend-only and does not change report status, workflow progression, permissions, database fields, notifications, or Supabase behavior.

## Build 53.1 — Corrective Action UI Polish — 2026-10-07

This frontend-only polish keeps the existing corrective-action workflow, database fields, permissions, notifications, and RPC behavior unchanged while making Step 3 more compact and easier to follow.

- After the Yes/No corrective-action decision is selected, the large decision choices collapse into a compact summary with **Change decision** when the step is still editable.
- Plan & Assign removes redundant instructional blocks so the first corrective-action card appears sooner.
- Each action keeps the same five required values: what needs to be fixed, assigned owner, due date, priority, and type of fix.
- On desktop, Assigned to / Due date / Priority share one compact row; mobile layouts stack cleanly.
- Priority is now a direct Low / Medium / High button choice instead of a dropdown.
- Assigned actions show the same compact Owner / Due / Priority / Type summary across Plan & Assign, Complete Work, and Verify.
- Activated plans remain collapsed behind **View plan details** unless the plan itself needs editing.
- No Supabase migration or Edge Function deployment is required.

Build 54 remains reserved for the planned Scheduled Company Records Archive work.

## Build 53.1.5 — Final close navigation fix (2026-10-07)
- After a successful final **Close report** action, the dashboard now returns to **Home** automatically.
- Home counters, Needs your attention, My Work, and Corrective Actions refresh using the newly closed state.
- The closed record remains available through the Closed filter as a read-only finalized record.
- No database, Supabase, notification, role, or workflow-schema changes.


## Build 53.1.6 — Profile Support Removal — 2026-10-07

Removed the customer-user **Support** tab and in-profile feedback submission form so account-level questions and change requests can be coordinated through the person responsible for the customer's TeamWorkt Safety account. Profile and Security remain unchanged, and the existing Help Coach remains available for workflow guidance. Historical feedback records and the Admin/Platform feedback viewer are preserved. No database, Supabase, notification, role, workflow, or archive changes are required.


## Build 53.1.7 — Public Reference Guide Link — 2026-10-07

Added a sanitized PDF workflow reference guide at `docs/RBH_Safety_Workflow_Reference_Guide.pdf` and linked it from the desktop `?` Help Coach. The PDF uses generic example identities/data so it can be served as a public documentation asset. Existing contextual Help Coach walkthroughs remain unchanged. No database, Supabase, notification, role, workflow, or archive changes are required.

## Build 53.1.10 — Injury Screening Reference Guide Update — 2026-10-07

Updated the public workflow reference guide linked from the desktop `?` Help Coach. Step 1 now includes a dedicated Injury / illness regulatory-screening section with the current Screening Result choices (`No`, `Unsure`, `Yes`), the conditional company-awareness and Cal/OSHA notification fields shown for each choice, save/validation behavior, persistent follow-up behavior, and the final-close safeguard. Added the injury-screening screenshot to the guide and updated the email documentation to reflect grouped initial-intake recipients and the high-priority injury subject. This is documentation-only; no dashboard workflow, database, RLS, RPC, notification logic, or Edge Function behavior changed.


## Build 53.1.11 — Final UX Cleanup — 2026-10-07

Customer-facing cleanup pass before interface freeze. Changes include open-injury Home counting, natural-height Home panels, name-based Recent activity actors when available, simplified overdue wording, removal of duplicate Step 4 close control, Analytics empty state, clearer Report Owner / intake / profile / export labels, removal of developer-era Admin wording, platform feedback wording aligned to the retired in-profile support form, and a refreshed four-step README. No database, RLS, RPC, notification-routing, corrective-action lifecycle, or record-retention behavior changed. Reopen behavior was not altered because the RPC implementation is not included in this repository and should be validated against the deployed database before changing its explanatory copy.
