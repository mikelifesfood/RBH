# TeamWorkt Safety — Next Handoff: PWA, QR, Roles, and Safe Cleanup
Updated: November 14, 2026
Repository: `mikelifesfood/RBH`
Working branch: `teamworkt/supabase-security-20261114`
Live GitHub Pages: `main` (not changed during this refactor)
Pilot Supabase: RBH Insulation, project `owhkxguiavgxzwvbxevj`

## Decisions locked in
1. **One installation per paying customer.** Each business will have an independently deployed website/PWA, Supabase project, Auth users, Storage, Edge Functions, secrets, reporting data, and Brevo configuration. Shared master code and migrations, not a shared customer database.
2. **PWA first, no App Store/Play Store requirement.** Employees use a web link or QR code without an account; authorized staff can install the PWA to their Home Screen. Native apps are optional later, not a dependency.
3. **Job-site QR codes.** Support a company-wide QR and optional site-specific codes; a validated opaque site code preselects the site. Printed codes carry no secrets. Workers can report without logging in.
4. **Offline-first requirements.** Service worker for previously loaded forms; IndexedDB for draft report and photos; explicit queued/not-yet-submitted status; foreground/reopen retries; deduplication via idempotency keys verified on the backend; never represent locally saved as server-submitted. iOS background sync cannot be assumed, and an uncached page cannot be guaranteed to load offline.
5. **Keep existing user roles exactly as built:** `admin`, `safety_manager`, `supervisor`, `read_only`. Preserve current role capabilities, assignment checks, administration, corrective actions, reports, emails, notifications, exports, and public intake. Do not repurpose `platform_admins` as the ordinary company `admin` role.
6. **Do not upgrade Supabase solely to enable leaked-password protection.** It is unavailable on the RBH pilot plan and is documented as a plan limitation.

## Safe cleanup completed in this turn
- Audited the live 17-table schema, foreign keys, trigger references, privileged database functions, all deployed Edge Functions, and GitHub `dashboard.html` and `index.html`.
- Confirmed active dependencies prevent safe deletion of `organizations`, `organization_memberships`, `platform_admins`, `admin_user_events`, `app_feedback`, and incident/evidence/audit/notification tables.
- Updated **only** `dashboard.html` on the security branch:
  - `loadPlatformSummary()`: four previously sequential, independent Supabase reads now use `Promise.all` with the same queries, error handling, and rendering.
  - `loadPlatformCompanies()`: four previously sequential, independent reads now use `Promise.all` with the same queries, error handling, and rendering.
  - Introduced `saveFeedbackStatus(id,status)` to share the same feedback status update across Admin Feedback and Platform Feedback, keeping the original success/error messages and per-view refresh functions.
- The HTML, role names, UI navigation guards, all user-management workflows, provision/manage Edge Functions, and live database were **not** changed.
- Re-fetched and verified that GitHub `main` is unchanged and branch `dashboard.html` contains the intended refactor.

## Why more platform-table deletion was NOT attempted
- `organizations`: per-installation single-company configuration, company name and branding; also referenced by existing reports and other foreign keys.
- `organization_memberships`: live `admin-provision-user` function reads and writes this table; platform reporting uses it.
- `platform_admins`: live dashboard checks it to show an existing platform-administration screen. This separate role/feature currently has behavior and must not be removed under the user's nonfunctional-cleanup constraint.
- `admin_user_events`: management/audit history written by `admin-manage-user`.
- `app_feedback`: actively referenced by Admin and Platform Feedback views and by `rbh_submit_feedback`.
- `report_notification_events` and `report_workflow_restarts`: operational send history and workflow restart audit, intentionally service-private.
- `organization_admin_invites` was previously removed only after verified empty and dependency-free; no additional table met that standard today.

## Quality gates
**Completed checks:** committed file re-fetch; main-vs-branch comparison; static checks of the four unchanged role labels, unchanged company creation, platform/admin navigation guards, shared feedback helper call count, and preserved notification usage.

**Not yet verified:** end-to-end browser regression with actual accounts, report creation, feedback status, company creation, email delivery and all assignment paths. Do not merge or deploy until those pass. Parallelizing independent reads should not alter row handling, but full browser testing still matters.

## Supabase security and remaining engineering
- Keep public `submit_report` and `add_attachment` working, while planning backend-verified Cloudflare Turnstile and rate limits on a later coordinated frontend + Edge Function + RPC rollout.
- Keep RBH-specific default organization IDs in place in the pilot until a clean per-customer bootstrap and all server-side writers can reliably supply configured organization IDs.
- Build one-click repeatable customer installation from a reviewed schema-only export; current SQL files are **incremental**, not a complete fresh-install baseline.
- Next implementation phase: user-visible offline drafts/queue, job-site directory and printable QR codes, safe submission dedupe, robust notification error tracking, and a full role-based browser regression.
- If the product later removes the platform administration feature, treat that as an explicitly approved separate feature change. The current instructions forbid changing its functionality.

## Exact changed paths in this turn
- **Updated:** `dashboard.html` (security branch only; no live publish)
- **New:** `supabase/TEAMWORKT_NEXT_HANDOFF_PWA_AND_SAFE_CLEANUP.md` (this document)
- **Database:** no new schema changes or deletions in this turn
- **Edge Functions:** no deployments or function changes in this turn
- **GitHub `main`:** unchanged
