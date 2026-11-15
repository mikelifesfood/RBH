# TeamWorkt Safety — Customer Supabase Installation Blueprint (Draft)
Last verified against the RBH pilot: 2026-11-14

## Deployment boundary

**Current direction:** use the RBH Supabase project as a pilot, but deploy separate customer databases/projects for customer production. This avoids placing all customers' incident reports and evidence in a shared production Supabase project. Per-project costs, backups, secret management, migrations, and operational maintenance need to be included in the commercial rollout plan.

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
