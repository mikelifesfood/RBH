# TeamWorkt Safety — RBH Full Working Demo → MVP Go-Live Handoff
**As of:** Saturday, November 14, 2026 (end-of-day checkpoint)  
**Purpose:** Single starting point for the next ChatGPT conversation. Use this first, then consult the older technical handoffs.  
**Status:** Development plan; **not yet a working MVP and not authorized for commercial go-live**.  
**Source of truth:** GitHub `mikelifesfood/RBH`, `main` is now the sole normal development/published branch. The historical branch `teamworkt/supabase-security-20261114` has been fast-forwarded into `main` and is retained only as a reference. Supabase project `owhkxguiavgxzwvbxevj` is the **RBH Insulation pilot only**.  
**Last checked:** November 15, 2026 GitHub reconciliation: `main` was fast-forwarded to commit `6770a533e91fd60f7a7177d1fcca5594f7a226c1` (18 previously outstanding commits); a compare then confirmed `main` and the old security branch were identical. As of the November 14 database checkpoint: 17 public tables, 4 test reports, 4 test profiles, one organization, and a Vault notification secret present. The updated dashboard has **not** completed full browser regression. The GitHub update did not rerun SQL or redeploy Edge Functions.

## 0. Instructions for the next assistant
1. Start by reading **this handoff**, `supabase/TEAMWORKT_CUSTOMER_INSTALLATION_BLUEPRINT.md`, `supabase/TEAMWORKT_SECURITY_STATUS_2026-11-14.md`, `supabase/TEAMWORKT_PUBLIC_INTAKE_ANTIBOT_PLAN.md`, and `supabase/README.md`; inspect actual GitHub/Supabase current state before edits. The original `TeamWorkt_Safety_RBH_Project_Handoff_2026-11-14.docx` explains the original backlog. Some prior documents have historical counts/statuses; **current connected state wins**.
2. Work only in `mikelifesfood/RBH` and RBH Supabase project `owhkxguiavgxzwvbxevj`; **never touch Wandering Casks, Lane Log or unrelated projects**.
3. **Always tell the owner exactly which paths, SQL objects, Edge Functions and behaviors will change before making any change.** Preserve the four existing roles and their permissions, all existing workflows, history, exports, bilingual features, and existing Brevo rules. Use a staged rollout, verify, and give rollback steps; distinguish GitHub-only vs SQL/Edge/Xcode (Xcode **not** required for this PWA).
4. Per the November 15 owner decision, work directly on `main` for RBH test/pilot development. Record exact changed/new/deleted paths and rollback commits. Because GitHub Pages publishes from `main`, test after each small change and do not represent untested changes as verified. Use a temporary branch only for unusually risky or multi-step changes, not as the standing working copy.
5. Treat existing RBH records as fake test data (owner confirmed this), but avoid deleting data without previewing the exact change. Existing test accounts and cases are useful for regression.
6. Explicitly distinguish **implemented**, **confirmed to build**, **candidate enhancement**, and **post-MVP custom work**. A plan or existing UI text is not proof a feature has been tested or works.
7. Keep a single consolidated checklist here; update statuses after each completed build and test.

## 1. Commercial product direction (confirmed vs unresolved)
- **Brand/product:** TeamWorkt Safety, developed/tested using RBH Insulation, aimed at small contractors and other small companies (~20–150 employees as initial hypothesis).
- **Model:** Each customer receives an **independent full deployment**: own PWA/website hosting, Supabase project/database, Auth users, private Storage, functions, credentials, branded settings and Brevo notification configuration. **No cross-company shared database.** One maintainable master codebase and repeatable customer-deployment process.
- **Distribution:** **PWA-first**; no Apple App Store / Google Play release as a core requirement. QR scanners open the browser directly; management staff may install the PWA on their Home Screen.
- **Working pricing offer:** **$149.99/month per company with proposed unlimited users and employee reports**. The owner has expressed a preference for unlimited users; do **not** impose new arbitrary user limits or reduce reporting in the app. Before advertising this as a contractual commitment, model per-customer Supabase hosting, data storage, Brevo volume and support costs, and define reasonable storage, file-size, retention and fair-use terms.
- **Customization policy (new decision):** The completed RBH product, including confirmed new MVP additions below, becomes the **standard baseline** for future small-company customers. Requests for features or modifications **outside that standard baseline** will be scoped and quoted as **additional one-time charges**, not automatically included in the $149.99 subscription. If a custom feature creates ongoing infrastructure, email, storage, vendor, maintenance or support costs, price and disclose those recurring costs separately; a one-time build fee alone may be insufficient.
- Reuse of new features across customers should be governed by the standard master version and a documented customization/change-request process; do not introduce one-off code forks by default.
- **Not yet decided:** setup/installation fee, domain costs, hosting ownership, SLA/support hours, contractual storage/retention allowances, support for jurisdiction-specific regulations, and exact custom-development pricing. These are business decisions, not reasons to pause building the RBH demo.
- **No unsupported compliance guarantees**, including OSHA/Cal-OSHA compliance claims.

## 2. EXISTING RBH FUNCTIONAL BASELINE — MUST BE PRESERVED, VERIFIED
These are existing code/prototype features; verify the behavior end-to-end before marketing as functional:
- Public mobile-friendly **no-login** employee intake for injury/illness, near miss and safety concern; optional anonymous vs identified report; English/Spanish; emergency guidance; attachments/photos; report receipt/reference.
- Four-stage incident lifecycle **Review → Investigation → Corrective Actions → Close**, with clear assigned Report Owner, investigator/manager actions and complete audit history.
- Corrective Action subflow **Plan & Assign → Complete Work → Verify / Request Changes**, including responsible owners, due dates, evidence, verifier separation, return-for-changes, and close gates. Previous stages become read-only as currently designed.
- Existing jurisdiction-specific serious-injury/Cal-OSHA screening and regulatory follow-up fields in RBH. Keep RBH functionality, but parameterize legal wording for other customer jurisdictions later.
- Roles **exactly** `admin`, `safety_manager`, `supervisor`, `read_only`. Do not rename or change their current rights, assignment logic, report visibility or administrative capabilities. Keep the separate legacy `platform_admins` capability until intentionally redesigned; it is **not** the ordinary company `admin` role.
- Admin user provisioning, password reset, role/active management and protected last-admin safeguards; dashboard, My Work/action queue, role-aware views and report history.
- Investigation notes, evidence handling, notifications, read/unread/acknowledge actions; audit trail, workflow restarts/reopens; concurrent record presence/change signals.
- Brevo email notifications for new intake, investigator, corrective owner and verifier assignment as currently routed. Confirm actual triggers, recipient selection, per-event idempotency and email content; test bilingual and injury priority behavior.
- Exports: report PDFs, CSVs, Admin-only company records ZIP containing report PDFs/evidence/manifest/hashes. Preserve authorization and error handling; don't mistake an export ZIP for a full database backup.
- Current feedback/admin views and desktop Help Coach; avoid deleting these accidentally in a cleanup.
- Company/platform summary screens currently exist. Even if some are excessive for future single-company deployments, do not delete screens or backing tables under a **no functional change** instruction.

## November 15, 2026 — Build 2 notification preference implementation

- **Implemented (RBH pilot):** Admin-controlled **initial new-report email delivery** with Grouped (default), Individual (one message/recipient), or Off (also disables urgent injury intake emails, with confirmation). Other email events and in-app notifications remain unchanged.
- **GitHub `main` changed:** `dashboard.html`, `supabase/functions/notify-report/index.ts`; **new** `supabase/patches/20261115_teamworkt_report_email_preferences.sql`. Updated the email flow document and this handoff.
- **Supabase RBH:** applied `teamworkt_report_email_preferences_20261115` migration, adding RLS-protected `report_email_settings` and Admin-only `rbh_get_report_email_mode` / `rbh_set_report_email_mode` RPCs; deployed `notify-report` Edge Function version 40. Default remains grouped and no existing company setting was overwritten.
- **Verified:** transaction-scoped admin RPC set/read for Grouped, Individual and Off, invalid option rejection, Read Only user rejection (rollback preserved no setting row). **Not yet verified:** browser interactions and actual inbox delivery in Grouped and Individual modes; owner should use fictional report(s) to test. No intentional test email issued in this build.
- **Scope clarification:** company-level individual/grouped/off only affects initial intake emails. Future per-event toggles, workflow email policies or individual user opt-outs are separate enhancements and should be approved explicitly.

## November 15, 2026 — Build 4: PWA installation and safe public-form caching

**Implemented on GitHub `main`, GitHub Pages hosting (no Supabase/Edge/Brevo changes):**
- Separate PWA manifests for the anonymous public intake (`manifest.webmanifest`, starts at `./`) and authorized staff dashboard (`dashboard.webmanifest`, starts at `./dashboard.html`). Both use `./` scope and distinct IDs to permit separately labeled Home Screen shortcuts.
- Added app icons `icons/icon-192.png`, `icons/icon-512.png` (maskable), `icons/apple-touch-icon.png` for supported Android/desktop/iPhone installation.
- Added `pwa-client.js` with opt-in browser installation prompt, iOS Safari Add to Home Screen directions and bilingual offline warning for the reporting form.
- Added `sw.js` (cache name `rbh-public-shell-v3-20261115`) and `offline.html` with English/Spanish guidance. The service worker stores only public form HTML, safe install icons, the warning script, and the static offline page. Public form navigation is **network-first** with cached shell fallback. Dashboard navigation is network-only, with **static offline explanation** if unreachable. It does **not** cache signed-in dashboards, report data, photos, login tokens, Supabase API responses, notification endpoints, or any POST. Cross-origin resources are never intercepted.
- Changed only `index.html` and `dashboard.html` to add their respective manifest, icon tags and defer-loaded PWA client. QR URLs, report submission and existing roles/workflows remain unchanged.

**Verification:** GitHub new files and icon object SHA/size confirmed. Web manifests parse as JSON with intended start URLs and icons. JavaScript in `index.html`, `dashboard.html`, `pwa-client.js` and `sw.js` passed static syntax checks. Service worker was simulated with mocked fetch/cache: GET public online goes to network, public offline falls back to cached HTML, dashboard offline falls back to `offline.html`, cached `pwa-client.js` remains available offline; private Supabase requests and POST submissions are not intercepted or cached.

**Not yet confirmed:** Live GitHub Pages availability of newly published assets (remote web fetch was unavailable), real Android Chrome and iOS Safari installation, home-screen icon appearance, real airplane-mode navigation, browser storage eviction, real QR navigation after installation. **Do not mark the PWA as device-tested yet.**

**Critical scope:** Build 4 does **not** implement offline report drafts or offline photo queues. The previously loaded public form may display when disconnected, but explicitly warns **view only**, and submission is blocked when `navigator.onLine===false`. An already filled report is not saved offline. Reliable offline drafts, photos, upload retries and server-side idempotency keys remain a separate later build; never tell users an offline report was submitted.

**Owner test gate:** Open both URLs over HTTPS online, verify manifest/icon/install or Add to Home Screen, install the public reporting app and staff dashboard separately (if supported). Visit public form online once before airplane mode. Disconnect and reopen: public form should display an amber offline warning and reject submission; staff shortcut should show a safe offline message without cached reports. Reconnect and verify normal reporting and logged-in dashboard functionality still work. Device/OS browser install prompts are not identical, and background syncing is not promised.

**Rollback:** Revert only Build 4 web HTML link/script changes and new static resources as necessary. **Previously installed service workers remain registered on devices** even after server files are removed; for a full rollback, temporarily deploy a worker that deletes `rbh-public-shell-*` caches, tells clients to unregister, and verify those clients receive it before removing `sw.js`. Avoid deleting service-worker code first and leaving old installed caches orphaned. No database rollback is required.

## November 15, 2026 — Build 3 follow-up: permanent Job Site Delete

- Owner approved **Delete instead of Deactivate** for disposable job sites. Admin Settings now shows **Delete** with a strong confirmation explaining that QR codes immediately become invalid and the deletion cannot be undone. Legacy inactive sites retain **Reactivate** solely to recover sites deactivated under the earlier interface.
- New Admin-only `rbh_delete_job_site(uuid)` RPC from `supabase/patches/20261115_teamworkt_job_site_deletion.sql`, deployed to RBH Supabase. It enforces active Admin membership in the configured organization and deletes the site row.
- **Reports are never deleted**: the pre-existing `reports.job_site_id REFERENCES job_sites(id) ON DELETE SET NULL` detaches the site association, but the report's free-text `job_site`, `site_location`, report content, attachments and audit data remain. Such reports appear under the Safety Inbox **Other / unregistered locations** site filter instead of under the deleted site.
- GitHub `dashboard.html` updated to replace the Deactivate control with Delete, confirmation, and report/filter refresh. No changes to `index.html`, `job-site-poster.html`, Brevo, or existing report workflows. No existing sites were deleted by this implementation.
- Transaction-scoped tests passed: Admin create/delete, non-Admin rejection, deleted-QR lookup failure, second-delete rejection. The database transaction was rolled back; backend report association preservation follows the verified FK definition. Dashboard inline JavaScript passed syntax validation. Owner should test Delete with a disposable site in the browser.

## November 15, 2026 — Build 3 Job Sites & Site-Specific QR (RBH pilot)

**Implemented in GitHub `main` and RBH Supabase:**
- Admin-only job-site registry (create, rename, optional address, activate/deactivate) and unique stable 128-bit public QR identifiers. Existing four roles remain unchanged. Deactivated sites stop resolving, without deleting historical reports.
- `job-site-poster.html?site=<opaque-code>` generates an active-site-specific printable poster; `report-poster.html` remains the original company-wide QR poster.
- `index.html?site=<opaque-code>` resolves a site through a server-side function, shows the selected site, and allows reporting another location without the original site association. An invalid/inactive code visibly fails rather than silently associating another site.
- Existing server-side `submit_report(payload)` validations retained, now validating the site code and associating `reports.job_site_id` with the registered site, while keeping historical free-text `job_site` data.
- Admin registry under Admin Settings and Safety Inbox site filter (including unregistered/legacy reports).
- Source: `supabase/patches/20261115_teamworkt_job_site_registry.sql` applied once; `dashboard.html`, `index.html`, and new `job-site-poster.html`.

**Verification:** SQL transaction tests passed site create, rename stability, deactivation, invalid token rejection, report association, and Read Only denial. One persistent fake job-site `RBH Demo Job Site — TEST ONLY` created (no address), code `941f56a8250e46228bfea9d3a740f434`. Fake report **#48** stored the correct site UUID/name; two grouped Brevo provider acceptances recorded. All other existing reports retain null `job_site_id`. All inline browser scripts passed syntax parsing.

**Still requires owner device/browser testing:** Admin create/edit/activate, printed QR scan on iPhone/Android, mobile public form preselection and change-location behavior, actual printable QR rendering (the poster loads pinned `qrcodejs` from a CDN), Save and Safety Inbox filter. Do not mark production-ready or start Build 4 before those browser checks pass.

**Rollback:** revert the specific GitHub commits affecting `dashboard.html`, `index.html`, `job-site-poster.html` to return to the existing company-wide reporting flow. Leave the additive schema/table/column in place while investigating (do not drop live report associations). Do not restore the original SQL submit function without first checking whether current reports depend on the new behavior.

## 3. CONFIRMED BUILD ADDITIONS for the RBH FULL WORKING DEMO / STANDARD MVP
The next chat should prioritize completing these, without replacing existing functionality. All remain **unimplemented or not fully demonstrated** unless separately verified.

### P0 — job-site / QR-code reporting (required for demo)
- [ ] Add a **job-site registry** in RBH Admin (site name, optional address, active/inactive status, public opaque identifier); preserve legacy free-text `job_site` / `site_location` data and reports.
- [ ] Support a **company-wide reporting URL/QR code** and **separate site-specific QR codes**; downloadable/printable poster with clear label and mobile scan testing.
- [ ] Scanned link launches RBH's **anonymous public form** with the correct site preselected. Show selected site; allow correction/other site per configured rules. Invalid, inactive or tampered site identifier must not silently associate the wrong site.
- [ ] Store site association server-side and show/filter it in report review, exports and email context. Reusing a QR after a harmless site rename should work.
- [ ] Do not include secrets, PII or raw authorization identifiers in printed codes.
- [ ] Test iPhone/Android QR camera scan, direct link, Spanish/English, anonymous/identified cases, multiple sites, deactivation, and file upload.

### P0 — installable, offline-capable PWA (required for demo/MVP)
- [ ] Add a proper PWA manifest, app icons, scoped service worker and update/version strategy to each customer's deployment; verify Home Screen installation.
- [ ] Cache *only* the necessary public intake and non-sensitive UI resources so a **previously loaded** form opens when offline. Scanning an uncached URL for the first time while offline cannot be guaranteed.
- [ ] Use **IndexedDB** to persist pending report fields and photo/evidence blobs locally; protect against duplicate submits and interrupted page reloads. Explicitly identify local drafts as **not yet submitted**.
- [ ] Show clear states: **Saved on this device / Not submitted → Uploading/Synchronizing → Received by server**, plus retry/error and offline indicators. Manual retry and restore drafts on reopen; optional delete unsent draft.
- [ ] On reconnect/foreground/reopen, retry safely. **Do not rely on iOS background sync while the app is closed.**
- [ ] Add a **client submission ID and backend idempotency key** to prevent duplicate reports, evidence, and email sends when network requests retry.
- [ ] Upload photos after the report acknowledgement using a robust retry/reconciliation process; prevent orphaned files and communicate partial attachment failures clearly.
- [ ] Secure browser storage: avoid caching sensitive authenticated reports or credentials, clear relevant private cached data on logout, and document that cleared/evicted browser data can remove unsent drafts.
- [ ] Test interrupted connections, airplane mode, large photo, low-storage, app killed/reopened, mixed bilingual, accidental resubmit, and eventual email once only.

### P0 — public intake hardening (required before going live)
- [ ] Protect the *backend*, not just the browser, against high-rate anonymous submissions. Recommended **Cloudflare Turnstile Managed**, but user has not formally selected it. Requires sitekey, dashboard secret and coordinated frontend + Edge Function + RPC change. Avoid a mandatory employee login.
- [ ] Provide token failure/retry messages and accessibility alternatives; do not revoke direct anonymous `submit_report` before the new protected endpoint is live and validated.
- [ ] Add credible rate limits/burst control and operational alerts; verify file sizes/types, attachment total limits and storage permission paths; use signed, report-scoped upload flow or equivalent service control when ready.
- [ ] Confirm none of the new protections break public reports launched by QR codes.

### P0 — mobile usability and simplified admin UX (required before demo signoff)
- [ ] Review all public report inputs on common iPhone/Android screen sizes, large text, keyboard behavior, camera/photo selection, navigation and accessible touch targets.
- [ ] Keep the familiar four-stage workflow and role-specific controls; improve clarity, due/overdue prominence and attention-first manager homepage without changing permissions.
- [ ] Verify each recipient can tell the next action required, and that an incomplete required action cannot be closed by mistake.
- [ ] Keep English and Spanish consistent for the public reporter and existing app preferences.

### P0 — dependable notifications and audit evidence
- [ ] Verify/update the precise **event → recipient → subject/body → logs** matrix for new reports, injury priority, investigator assignment, action assignment, verifier assignment, change request, completion, closure, restart/reopen and any presently configured in-app alerts. Distinguish emails that are **already** implemented from proposed emails.
- [ ] Preserve rotated webhook secret (Edge env `WEBHOOK_SECRET_NEXT`, Vault `rbh_notify_report_webhook_next`) and Brevo sender configuration; do not leak or rotate working secrets unnecessarily.
- [ ] Confirm provider acceptance **and actual delivery where possible**. Add retry/failed-notification monitoring, idempotency, and recipient privacy checks; no duplicate emails after offline retries.
- [ ] Produce/update one clean **notification flowchart** and recipient matrix to support demos and sales conversations.
- [ ] Keep email as primary channel and in-app notification center. **Optional Web Push** (with supported OS/browser and permission limits) is a subsequent enhancement unless essential to a customer demo.

### P0 — reproducible deployment, recovery, QA and commercial launch gate
- [ ] Reconcile current GitHub `main` vs working security branch vs live Edge Functions/migrations, then stage and test coordinated changes; don't casually overwrite a known-good UI.
- [ ] Create **versioned fresh-install schema baseline**, source-controlled functions/Storage/RLS/trigger setup and **per-customer configuration** (company name/logo, default organization, language, jurisdiction, timezone, sender, recipients, domain, initial admin); strip hard-coded RBH IDs from the reusable template.
- [ ] Deploy and test a **second completely separate Supabase project** and PWA deployment using sanitized seed data, no real RBH records or secrets. Confirm automated install/upgrade/rollback and per-customer isolation.
- [ ] Establish backup/restore test, retention/export/deletion process, activity logging and customer offboarding procedures; a ZIP export is not a DB restore.
- [ ] Verify permission/RLS/SECURITY DEFINER access for all four roles and anonymous users, including direct RPCs and private evidence signed URLs. Keep internal-only tables private.
- [ ] Full **report → investigation → action plan → owner completion → independent verification → closure**, reassign/restart/reopen, evidence, PDF/CSV/ZIP and Brevo/in-app regression.
- [ ] Test actual mobile browser and home-screen PWA, public QR intake and offline/online recovery with test users; verify basic accessibility.
- [ ] Configure domain, HTTPS, email sender, DNS, monitoring/incident response, privacy policy, terms/support and a clear non-compliance disclaimer. RBH currently uses GitHub Pages; Cloudflare/Vercel hosting has not been configured for RBH.
- [ ] Create a sales-ready RBH demo data/story pack with fictional examples and a concise walkthrough. Do not present test/demo records as real incidents.
- [ ] Do not call MVP production-ready until these tests are observed and documented, not only source-reviewed.

## 4. P1 / P2 CANDIDATE FEATURES — CARRY FORWARD BUT DO NOT SILENTLY PROMOTE INTO BASE MVP
These came from the original handoff as proposed enhancements. **Owner should choose whether they belong in the standard base offering after P0 is demonstrable.** They are listed here so they are not lost.
- [ ] **Safety Pulse (P1 candidate):** weekly digest of new/open/closed cases, overdue actions and trends; email or dashboard settings; scheduled delivery, preferences and dedupe.
- [ ] **Repeat-hazard insights (P1 candidate):** rule-based recurring categories, sites and reporting windows, with basic counts/trends; no AI required.
- [ ] **Reporter status (P2 candidate):** random receipt token and minimal anonymous status lookup; no sensitive investigation data exposed.
- [ ] **Lessons Learned (P2 candidate):** human-reviewed, sanitized post-closure summary/bulletin.
- [ ] **Effectiveness check (P2 candidate):** scheduled follow-up after closure to verify corrective action remains effective.
- [ ] **5-minute safety walks (P3 candidate):** lightweight site checklist; failed item can become a report/action.
- [ ] **Optional PWA Web Push (future):** supported-device notifications after explicit permission; emails remain primary.

## 5. OUT OF SCOPE for standard MVP unless separately agreed
OSHA compliance automation/legal advice, voice/AI analysis, large LMS or HR training suite, complex inspections, equipment inventory, contractor prequalification, enterprise EHS workflows, sophisticated predictive analytics, and native iOS/Android apps. Job-site QR and offline PWA are now **confirmed**, overriding their earlier suggested/on-hold status. Cal-OSHA fields already in RBH are preserved but **not** a universal regulatory-compliance warranty.

## 6. Known current security/state facts and caveats
- RBH Supabase currently has **17 public tables** (legacy empty `organization_admin_invites` removed after dependency check). Most company/platform tables are still used and must not be dropped until their role/provisioning/admin dependencies are refactored and tested.
- Security advisor last checked: **2 RLS-enabled tables with no browser policies** (service-private `report_notification_events`, `report_workflow_restarts`); **3 anonymous executable SECURITY DEFINER functions** (public intake and anonymous-upload helper); **27 authenticated SECURITY DEFINER warnings** requiring individual authorization analysis. These warning counts are *not* proof of exploitation.
- `auth_leaked_password_protection` remains flagged; user confirmed this feature is **unavailable on current Supabase plan**. **Do not request plan upgrade.** Use available strong password policies, MFA for privileged admins where feasible, onboarding controls and session monitoring.
- Performance advisor: **15 unindexed foreign-key findings** and approximately **43 low-use/unused index notices**; do not add/drop indexes solely to clear linter counts on a tiny pilot.
- Storage limits: private bucket and **10 MB per object**, anonymous uploads constrained to existing recent reports (up to 10 file objects per report in the current guard); authenticated same-org investigation uploads restored and checked.
- Brevo rotation: new-only webhook credential, old one removed; controlled test report #43 showed notification event `sent` with provider message ID, not direct inbox confirmation.
- One remaining critical check: the branch `dashboard.html` refactor has **not** been deployed to `main`; source checks passed but full browser regression pending.
- Do not touch unrelated Supabase/GitHub accounts, nor publish sensitive test data.

## 7. Prioritized work plan for the next chat
**Day 1: produce a working RBH demo, not a new architecture proposal.**
1. Inspect current RBH `main`, public `index.html`, `dashboard.html`, all deployed relevant Edge Functions and schema; confirm build snapshot and baseline test. The former security branch was consolidated into `main` November 15; `main` is the normal working branch.
2. Implement **site registry + one site-specific QR** with a fictional job-site record, keep the general QR, and test scan → correct site → anonymous form → case visible in dashboard. This gives an immediately demonstrable feature.
3. Implement **PWA manifest/service worker + offline local draft/queue** for public reporting, then test reconnect / retries and no duplicate reports. Split into safe, testable commits rather than a wholesale rewrite.
4. Add **mobile UX polishing** and basic report sync-status screens; preserve existing intake and investigation roles/flow.
5. Implement backend-verified public anti-abuse protection in coordinated order, **after obtaining necessary Cloudflare Turnstile choice/sitekey/secret** or a comparable approved approach. Do not accidentally block anonymous reporting.
6. Execute end-to-end **incident → assignments → investigation → corrective work → verification → closure**, with appropriate emails, in-app notification and export validation. Fix discovered regressions before adding optional features.
7. Prepare clean customer bootstrap/master migration while demo validation proceeds; do not confuse a working RBH pilot with a reproducible commercial install.

**Stop/go gates:** If QR intake, offline retry, roles/closing rules, evidence permissions, email delivery, or fresh-install migration tests fail, remain in pilot/demo state and fix before declaring MVP live.

## 8. Acceptance checklist for demonstration and MVP go-live
- [ ] Scanning a **printed job-site QR** opens the correct public form without account creation; site context survives report submission.
- [ ] Direct company QR opens the generic reporting form and allows appropriate site selection.
- [ ] Offline previously loaded form can save text and attachments locally; clear status **not submitted**; reliable recovery and eventual sync.
- [ ] A retry or page reopen does not duplicate case records, evidence, or emails.
- [ ] English and Spanish mobile public forms work; optional anonymity and injury flags are preserved.
- [ ] Admin, Safety Manager, Supervisor, Read Only access and all existing role-specific actions have no regressions.
- [ ] Complete four-stage workflow, corrective work / verification / change requests, strict closing gates and audit trail work.
- [ ] Existing regulatory follow-up for RBH works, without making blanket compliance claims.
- [ ] Brevo and in-app notifications reach intended roles and have monitorable delivery failures; notification flow diagram is accurate.
- [ ] Photo upload/download access, PDF/CSV/Admin ZIP exports and permissions work.
- [ ] Independent second-company installation can be reproduced from version-controlled schema/config with separate secrets/hosting.
- [ ] Backup/restore and minimum privacy/retention practices are documented and tested; security gaps triaged.
- [ ] Domain, support materials and clear demo-to-live handoff are ready.
- [ ] MVP acceptance confirmed by owner based on observed user journeys.

## 9. Pricing and change-request policy for future companies
**Standard product:** The agreed RBH MVP becomes the default TeamWorkt Safety offering for small customers at working target **$149.99/company/month** with proposed unlimited users and reporting, subject to a sustainable deployment cost model and written terms. Standard bug fixes, security maintenance and common updates should be considered in subscription support obligations rather than billed as a fresh feature every time.

**Custom enhancements:** Features beyond the accepted standard MVP require a customer-specific statement of work, explicit scope, one-time development/implementation charge, and regression testing. Illustrative future requests: special customer reporting dashboards, branded PDF/exports, an additional custom workflow, integrations with payroll/HR/other tools, industry-specific checklists, complex notice rules, or niche regulatory screens. These are **examples**, not approved backlog requirements. Ongoing third-party/API/storage or specialized support costs, if any, should be quoted separately. Maintain a shared core and separate configuration/extensions where possible to avoid permanently unmaintainable customer forks.

**Important:** Do not sell customized features as standard until deliberately added to the master and priced accordingly. Do not classify essential security fixes or defects in advertised baseline behavior as chargeable "new features" by default.

## 9A. Initial email recipients and notification diagram (verified)

- **When a report is first saved, the initial new-report email is sent only to active `admin` and `safety_manager` accounts with email addresses in that same customer installation.**
- `supervisor` and `read_only` accounts do **not** get this initial email simply because of their role. Subsequent assignment/workflow emails are separately addressed to the applicable assignee or Report Owner.
- Current RBH test accounts include **1 active Admin and 0 Safety Managers**; thus **1 current eligible initial recipient**. The function looks up recipients dynamically, so future active Safety Managers are included automatically.
- When a report indicates injury, the same Admin/Safety Manager recipients get an urgent/high-priority version; there is no extra role added.
- The original conversation-generated infographic is preserved as a PNG attachment in the chat. **An updated, GitHub-rendered graphic that documents the verified current recipients and all supported assignment/email events is included here: [TeamWorkt Email & Notification Flow](TEAMWORKT_NOTIFICATION_EMAIL_FLOW.md).** Use the updated visual for future development and sales discussions because it corrects earlier generic recipient wording.
- The diagram distinguishes observed receipt routing from email event handlers whose dashboard trigger still needs an end-to-end test. Don't promise automatic sends for unverified UI actions.

## 10. Source-control and operational handoff details
- GitHub repository: `mikelifesfood/RBH`
- Current public prototype: `https://mikelifesfood.github.io/RBH/dashboard.html`
- Primary development and GitHub Pages branch: `main` (former security branch consolidated November 15, 2026)
- RBH Supabase project: `owhkxguiavgxzwvbxevj`
- Existing Edge Functions: `notify-report`, `translate-report`, `send-action-assignment-email`, `manage-action-evidence`, `admin-provision-user`, `admin-manage-user`.
- Current roles: `admin`, `safety_manager`, `supervisor`, `read_only`.
- **This document is planning only.** Editing this Markdown on `main` should not modify `index.html`, `dashboard.html`, SQL schema, or deployed functions, and should not send any emails.
- Historical docx: `TeamWorkt_Safety_RBH_Project_Handoff_2026-11-14.docx`. Related branch docs: `supabase/TEAMWORKT_NEXT_HANDOFF_PWA_AND_SAFE_CLEANUP.md`, `supabase/TEAMWORKT_CUSTOMER_INSTALLATION_BLUEPRINT.md`, `supabase/TEAMWORKT_PUBLIC_INTAKE_ANTIBOT_PLAN.md`, and `supabase/TEAMWORKT_SECURITY_STATUS_2026-11-14.md`.
