# TeamWorkt Safety — Customer Supabase Installation Blueprint (Draft)
Last verified against the RBH pilot: 2026-11-14

## Deployment boundary

**Confirmed product requirement:** Each paying customer receives its own complete TeamWorkt Safety deployment: independent application hosting/deployment, Supabase project/database, Auth users, private file storage, Edge Functions, secrets, and notifications. RBH remains the pilot; the reusable master source code and repeatable migration/installation process are shared, but customer records are never combined in a central multi-company Supabase database. Per-installation costs, backups, secret management, migrations, and maintenance must be reflected in pricing. Existing RBH organization-scoped checks remain as defense in depth, not as a shared multi-tenant architecture.

Do not clone RBH production test records, Auth users, Storage objects, active webhook secrets, or Brevo history into a customer's project.

## Critical database configuration findings

Exactly these five existing public tables have an RBH-specific literal UUID default on `organization_id`:

- `reports`
- `report_attachments`
- `report_notes`
- `report_audit`
- `app_feedback`

**These defaults must NOT be copied unchanged into a customer installation.** They were inspected directly in the pilot's `information_schema.columns`.

Before launching a customer:
1. Create the customer's organization as a newly generated UUID.
2. Install every schema object, constraint, function, table, storage bucket, policy, and trigger using a vetted, ordered baseline migration.
3. Prefer explicit `organization_id` values derived from the caller's authorized organization or the target report. Never accept an unauthenticated caller-supplied tenant ID without validation.
4. Public `submit_report(payload)` presently relies on the default report organization. For one-project-per-customer, replace that with an installation-specific, server-controlled organization configuration during bootstrap. Do not add a customer-selectable organization field to the public report form.
5. Remove or replace the other four literal defaults when all triggers/RPCs that insert into those tables reliably pass an authorized organization ID.
6. Configure the unique customer Storage bucket and policies with anonymous intake scoped to actual recent reports; use private evidence storage.
7. Create a dedicated `notify-report` webhook secret in Edge Function Secrets and a matching new Vault secret. Never embed a webhook credential in database function definitions, migration files or client HTML.
8. Configure customer-specific Brevo sender, routing, dashboard URLs, branding, language, notification recipients, and jurisdictional guidance. Current email templates contain RBH naming and California-specific serious-injury notices. Do not reuse for another company's jurisdiction without review.
9. Set up initial administrative user using trusted backend provisioning; never let a browser user self-promote to admin.
10. Apply and test all RLS and privileged-function controls, especially company isolation, restart/closure authorization, and evidence upload flows.
11. Validate email acceptance, recipient delivery, retry behavior, and audit/notification event logging; do not treat the provider's `sent` status as inbox-delivery proof.
12. Verify actual public submissions, attachments, investigation, assignments, corrective actions, read-only access, report exports, account provisioning, and negative cross-company tests.

## Pilot-specific constraints / blockers

- `supabase/README.md` says the existing SQL scripts are incremental changes already applied to RBH. **They are not a fresh-install baseline.** A baseline is a separate deliverable.
- RBH's legacy public file upload policy and RPC are now constrained, but direct anonymous uploads still need operational rate limiting/CAPTCHA or a signed-upload intake redesign before commercialization.
- 2 remaining RLS/no-policy tables (`report_notification_events` and `report_workflow_restarts`) are intended backend-only; do not introduce general API read policies merely to appease the advisor.
- 3 anonymous privileged-function advisor notices are expected in the current design: `submit_report`, `add_attachment`, and `teamworkt_allow_anonymous_report_upload`. Keep reviewing the first two for abuse controls.
- Supabase leaked-password protection is not available on the RBH project's plan, per the user. Do not trigger or recommend an automatic upgrade. Compensating measures: strong signup/reset password requirements where supported, admin-provisioned access, MFA for privileged accounts, and session monitoring.
- Authenticated privileged-function warning count must not be lowered by blindly revoking EXECUTE: functions require individual, authorized use by RBH workflows.
- This branch is **not automatically deployed** to GitHub Pages and must not be merged into the original GitHub `main` until RBH browser regression testing passes.

## Customer-specific configuration contract (proposed)

For each customer deployment, capture: customer legal/display name, generated organization UUID, Supabase project reference, jurisdiction, industry-specific hazard choices, Brevo verified sender, dashboard origin, designated initial administrator, incident-intake recipients, privacy/retention policy, emergency/regulatory email wording, employee intake URL/QR code, and optional bilingual preferences.

**Do not retain any credential values in this contract.** Store secrets in Supabase Vault / Edge Function Secrets or an approved secret manager.

## Migration approach

A full schema baseline should be derived by an explicit schema-only export of the pilot, then reviewed to remove RBH-specific data, literal company IDs, legacy/duplicate policies and demo-only objects. Ensure the database triggers and every Edge Function are represented in source control. Rehearse installation into a new blank test project before declaring the installation reproducible.

This draft makes no changes to the RBH application's live tenant, users, test data, or GitHub `main`.


## Confirmed job-site QR reporting requirement

- Workers must be able to scan a QR code physically posted at a job site and submit a safety report on a mobile-friendly page without signing in, creating an account, or installing an app.
- Each customer installation must support an optional **company-wide reporting QR code** and **site-specific QR codes**; QR codes link only to that customer's independent reporting website and database.
- A site-specific QR code should include an opaque, non-secret site identifier in the URL. Backend validation maps this identifier to a site within the **current customer's isolated installation**; do not trust arbitrary site names or organization IDs in the request.
- The reporting page should show the site name clearly, allow workers to confirm the correct location, and provide a way to select another site or report a site that is not listed (subject to customer configuration).
- Submission collects report type, description, relevant date/time, optional photos/evidence, and optional contact information, retaining English/Spanish accessibility and existing notification/investigation workflows.
- The same printed site QR code must stay useful if the site is renamed. Admins should be able to deactivate a lost or obsolete QR code or a completed site, and generate printable posters/PDFs.
- Protect public QR entry against abuse using a backend-enforced verification flow, preferably Cloudflare Turnstile Managed mode subject to user approval; simply adding a client-side widget without a protected backend endpoint is insufficient.
- Do not print secrets, keys, employee information, or raw database credentials in QR codes.
- Future engineering tasks: add a job-site registry (site name, status, opaque public code, optional address), site code management within customer admin UI, QR code generation/download, validated prefill on public intake, report/site association, and job-site filters in dashboard and notification rules.
- Keep anonymous submission as a first-class requirement; rate limiting and verification must not impose an employee account requirement.

**Implementation status:** Product architecture and QR workflow are confirmed. This document update makes no live database or frontend changes; job-site registry, QR poster generation, and Turnstile backend enforcement still require implementation and testing.
