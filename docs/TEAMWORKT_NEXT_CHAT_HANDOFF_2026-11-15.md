# TEAMWORKT SAFETY
## RBH pilot — next-chat development and commercial MVP handoff
**Prepared:** November 15, 2026  | **Purpose:** Start a fresh development chat from a verified baseline  
**Status:** Safety Pulse committed to GitHub; authenticated browser acceptance pending. Do not confuse implemented source code with fully tested production behavior.

### 1. Executive starting point
RBH Insulation is the working pilot/reference implementation for **TeamWorkt Safety**, a narrow, easy-to-use reporting and corrective-action SaaS for smaller businesses. The proposed business price is **$149.99/month**, with **unlimited employee report submissions**; manager seats, storage/fair-use, support, setup fees and exact pricing terms are not yet finalized. Features in the agreed RBH MVP are intended to form the repeatable base product. Future customer-specific additions should be separately scoped and priced as one-time custom work.

**Non-negotiables:** Preserve Admin, Safety Manager, Supervisor and Read-only permissions; public no-login English/Spanish intake; existing email/in-app notifications; company/job-site QR reporting; offline draft/photo behavior; audit evidence and exports; and the four-stage workflow: **Review → Investigation → Corrective Actions (Plan & Assign / Complete Work / Verify or Request Changes) → Close**. Avoid unnecessary rewrites of `dashboard.html` or any change to role/closure logic. Do not touch unrelated GitHub/Supabase projects. Use RBH test data; make changes in small, verifiable batches and report exact files, SQL objects and deployment requirements.

### 2. Authoritative project locations
- **GitHub:** `mikelifesfood/RBH` — active pilot source; `main` is the working branch. Source of truth for frontend code and captured migration/function references.
- **Public dashboard:** `https://mikelifesfood.github.io/RBH/dashboard.html`; public intake is in `index.html` at the same GitHub Pages site.
- **Supabase:** project **RBH Insulation**, ID `owhkxguiavgxzwvbxevj`, `us-west-1`. Use only the RBH connector/project. The current database is *not* a clean from-scratch commercial template.
- **Transactional email:** Brevo via Supabase Edge Functions; sensitive keys remain in Supabase, never in GitHub or a handoff.
- **Primary current documentation:** GitHub `README.md`, `supabase/README.md`, `docs/TEAMWORKT_BUILD7_SECURITY_HANDOFF_2026-11-15.md`, `docs/TEAMWORKT_SAFETY_PULSE_2026-11-15.md`.
- **Previous baseline planning:** `TeamWorkt_Safety_RBH_Project_Handoff_2026-11-14(2).docx` (older strategy; some implementation statuses have since changed).

### 3. Current implemented baseline — do not rebuild
| Capability | Actual current state / qualifications |
| --- | --- |
| Four-step management workflow, role permissions, action owners, verification, restart/closure guards | Existing application baseline; preserve. |
| Public intake | Live no-login form with injury/near-miss reporting, photos, bilingual fields and safety guidance. |
| Job sites and QR posters | Company-wide printable QR poster and job-site management/QR flow are present in code; verify site-code behavior and print quality before launch. |
| Offline PWA | IndexedDB-based draft/outbox and attachment preservation, retry/reconnect handling, service-worker cache; code implemented, full post-security-cutover test still pending. |
| Email notifications | Live new-report notices to **active Admins and Safety Managers**. Per-company initial-intake delivery mode **Grouped / Individual / Off** exists in Admin settings and deployed `notify-report` function; Off suppresses intake emails, including injury notices. Assignment/workflow notices are separate. Retest delivery and privacy end-to-end. |
| Exports and audit trail | PDF/CSV; Admin-only company records ZIP with report PDFs, CSVs, files and manifest/hashes; test volume/completeness and download behavior. |
| Safety Pulse | Read-only Home widget implemented November 15, now **at the very bottom of the Home dashboard below primary action cards and activity**. Includes 30-day reports versus previous 30 days, unresolved, higher-severity open, overdue, 90-day repeated hazard categories by site, and three latest unresolved. It is **not** a weekly emailed digest. Browser/mobile QA pending. |
| Security Build 7 | Cloudflare Turnstile Managed + protected `submit-public-report` Supabase Edge Function and rate limiting; browser legacy fallback removed. Direct EXECUTE on `public.submit_report(jsonb)` removed from `anon` and `authenticated`; `service_role` preserved. User-tested protected online report and dashboard link. Some later regression checks remain. |
| Existing Help Coach / live presence / user administration | Existing feature set; do not remove. |

**Latest changes:** `dashboard.html` — Safety Pulse UI; then moved to bottom of Home in commit `c77235482d92dfc29b6ba946d3836eb870db3c0c`. The prior Safety Pulse feature commit was `d5027ee61e64e38d65395d3213d78c781b55fdc3`. Documentation is in the two November 15 GitHub docs noted above. **Important documentation inconsistency:** the initial Safety Pulse documentation describes its original position above the action buttons; code now places it below *all* other Home sections. Correct this in future documentation updates.

### 4. Next work — implementation order
Items are ordered to finish useful small-business functionality while guarding the working RBH pilot. **B = built, QA needed; E = enhancement; N = new; P = pre-launch operational gate; H = hold/defer.**

#### P0A — Immediate acceptance and low-risk polish (do first)
1. **Safety Pulse live QA [B]:** Verify desktop/iPhone layouts; confirm it stays below Open My Work, Submit a safety report, Needs your attention and Recent activity. Check numerical parity with Inbox/Analytics, data refresh, zero/empty states, job-site labels and Read-only access. Fix only observable issues.
2. **Intake post-lockdown retest [P]:** Submit an authenticated-dashboard-launched public report after both anonymous and authenticated direct-RPC grants were revoked; verify server receipt and notification. Earlier user tests passed after *anonymous* revocation, not specifically after the final authenticated revocation.
3. **Offline + photo regression [P]:** Simulate no connection, create queued report with multiple images, reconnect, complete interactive Turnstile if required, receive reference number, confirm all images and no lingering “Saved on device” after success. Cover iPhone Safari/PWA, failed upload, duplicate retry and discarded/expired Turnstile tokens. Do not assert that background delivery can silently satisfy Turnstile.
4. **Dashboard responsive usability [E]:** Check action buttons remain prominent; text wrapping, compact Home panels, filtered Inbox, analytics legibility and staff workflow on small screens. Focused polish only, no workflow redesign.
5. **Notification setting QA [B]:** Admin can choose Grouped / Individual / Off; verify save/restore, active Admin and Safety Manager recipient selection, injury urgency and hidden addresses, duplicate suppression; ensure all other assignment notifications remain independent. Add role-by-email matrix to permanent docs and verify actual message/template examples.

#### P1 — Next value-bearing product features
6. **Job-site trends / repeat-hazard drill-down [E]:** Expand the current Safety Pulse count-only recurrence into a usable filtered view by **site + hazard category + report type + time window**. Link results safely to authorized Inbox records. Distinguish multiple reports from confirmed repeat incidents; no AI diagnosis or false risk score. Add empty states and data provenance.
7. **Job-site QR journey QA and refinement [B/E]:** Validate unique site codes, active/deactivated site handling, prefilled site on public form, phone-camera scanning, printable poster layout, company-wide QR fallback and input tampering. Make it easy to reach poster from Admin without cluttering Home.
8. **Safety Pulse weekly digest [N]:** This is separate from the completed widget. Draft opt-in weekly summary of new/open/completed/overdue reports and corrective actions; schedule, timezone, recipients and notification preferences; privacy-safe Brevo templates, dedupe and retry. Confirm defaults and whether digest is in MVP before activating automated sends.
9. **Analytics cleanup [E]:** Clearer comparisons and job-site grouping, filters and drill-down; retain existing graphs and metrics unless a verified issue. Present counts, not compliance assertions.
10. **Manager mobile flows [E]:** Improve report review, assigning investigators/owners, evidence, approve/send back, Close on narrow screens; preserve all field validations, role guards and immutable prior steps.

#### P2 — Useful additions, decide whether required for first go-live
11. **Reporter status lookup [N]:** Optional private random reference/token; show minimal received/in progress/closed states only. No names, investigation details, attachments, or guessable sequential-reference-only lookup. Design retention/recovery/privacy requirements first.
12. **Lessons Learned [N]:** Admin/Safety Manager-reviewed, sanitized shareable summary from verified closed reports. Avoid automatic public disclosure; let company decide audience and timing.
13. **Effectiveness checks [N]:** Optional dated post-closure check, responsible owner and history; avoid silently reopening or rewriting closed reports. Decide expected owner and failure escalation.
14. **Five-minute supervisor safety walks [H]:** Minimal template-driven inspection with failed item leading to tracked corrective action; validate customer demand before first base-MVP inclusion.
15. **Scheduled company records archive — reserved Build 54 [H/P]:** Separate from existing Admin manual ZIP. Define schedule, secure storage/recipient, encryption, retention, access logs, recovery semantics and cost before building.

#### P0B — Commercial architecture, required before paid customers
16. **Create commercial TeamWorkt master [P]:** Separate private master source from public RBH pilot; externalize company identity, logo, theme, organization settings, timezone, permissible report categories, support contacts, notification modes and jurisdiction text. Do not assume private master already exists.
17. **Versioned fresh-install migrations [P]:** Consolidate current scattered SQL, RLS, RPC grants, functions, triggers, Storage policies, Auth configuration and seeds. Build an independently installable sanitized customer schema, including upgrades and rollback.
18. **Tenant isolation [P]:** **Independent Supabase project per paid company** and distinct frontend environment, secrets, email, data/storage, domain and admin bootstrap. Test cross-company access by direct API/RPC/Storage calls and role impersonation on separate test projects.
19. **Attachment token protection [P]:** Close the first-24-hour anonymous upload window that does not require the report-specific token, while preserving queued/offline recoveries. Review `add_attachment`, Storage policy and legacy upload compatibility; test before enforcement.
20. **Security review / role tests [P]:** Audit remaining public SECURITY DEFINER surface (`add_attachment`, site lookup, upload authorization), and case-by-case authenticated functions; existing RLS-without-policy entries may be intentionally private. Do not blanket-revoke. Check Auth, secrets, CORS/origin/hostname, rate limits, abuse controls and logging.
21. **Supabase leaked-password protection [P]:** Current **RBH pilot Supabase plan is not eligible**, so feature is **not enabled**. For **paid customers**, select an eligible Supabase plan, explicitly enable the protection in Auth settings, then *verify* it is active before launch. Never claim current RBH has it.
22. **Backups / disaster recovery [P]:** Confirm database backups and actual restore to separate environment, file recovery, deletion, export, retention, audit log preservation and monitoring. Manual ZIP export is *not* database backup.
23. **Automated tests and release process [P]:** Test anonymous/identified intake, offline photos, 4 roles, cross-tenant access, corrective-action lifecycle, evidence, email dedupe/routing, exports, upgrades and rollback. Add release notes, staging-to-production procedure and smoke tests.
24. **Privacy and legal basis [P]:** Customer data ownership, privacy/terms/DPA, injury/personally identifiable data, legal hold/retention and region-specific regulatory content. Preserve RBH California/Cal-OSHA logic as a configurable jurisdictional case, not general OSHA compliance guarantee.
25. **PWA installability and support [P]:** Validate Android/iOS/browser installation, update prompts, offline cache lifecycle, notifications expectations, accessibility and support instructions. No native App Store/Play Store release initially.
26. **Company onboarding [P]:** Admin invitation/provision, domain/hosting setup, branding, company/timezone, QR posters, staff training, email verification, default settings, backup baseline and customer acceptance sign-off.
27. **Commercial offer and billing [P]:** Proposed $149.99 monthly for unlimited employee submissions; determine management seats, photo/storage limits, fair use, implementation fee, annual option, cancellation, SLAs, support channels, invoicing/tax and initial customer costs. These are *business decisions*, not deployed product settings.
28. **Public demo/sales package [P]:** Isolated demo data, landing page, walk-through, prospect collateral, case examples, secure account creation, FAQs, support/contact details and first-customer onboarding checklist.

#### Explicitly deferred / not part of the narrow first product
General AI safety advice, voice-entry AI, automatic OSHA compliance determination, broad LMS/HR/training systems, equipment inventory, contractor prequalification, enterprise inspection suites, expansive occupational-health platforms and native phone apps. New custom client requests should be paid one-time add-ons rather than silently increasing every customer's base SKU.

### 5. Email recipient matrix: preserve actual distinctions
| Event | Intended recipient(s) | Built/configuration status | Next validation |
| --- | --- | --- | --- |
| Initial new safety report, including injury urgency | **Active Admin + Safety Manager profiles** in same organization | Deployed `notify-report` uses **Grouped / Individual / Off**, Admin-controlled in dashboard | Test actual Brevo To/BCC visibility, grouped versus one-per-person, no duplicates, Off behavior and injury email wording. |
| Report Owner assignment | Newly assigned Report Owner | Deployed workflow mail path | Correct owner, active user and same-organization checks. |
| Investigator assignment | Assigned investigator/case owner | Preserved workflow path | Trigger, opt-in/configuration semantics and delivery. |
| Corrective action assignment / changes requested | Assigned corrective-action owner | Deployed targeted mail path | Assignment, reassign, resend prevention and privacy. |
| Verification requested | Current Report Owner; fallback active Admin/Safety Manager if no valid owner | Deployed targeted mail path | Verify fallback and role eligibility with controlled tests. |
| Optional verifier assignment | Named verification owner where applicable | Legacy/optional supported path | Confirm current UI does not imply a mandatory verifier; preserve simplified workflow. |
| Safety Pulse weekly digest | **Not defined yet** | NOT BUILT | Define eligibility, schedule, opt-in, company toggle and preferences before implementation. |

**Caution:** Admin delivery mode applies to **new report intake emails**, not all assignment/action notifications. The customer needs clear separate settings and explanations; do not conflate them.

### 6. Known current security state and limits
Supabase security advisor read on November 15 still reports three anonymous-executable SECURITY DEFINER entries (attachment registration, job-site lookup, upload authorization), 32 authenticated SECURITY DEFINER findings, seven RLS-without-policy informational notices and leaked-password protection warning. These are findings, not proof of exploitation. Both anonymous and authenticated `submit_report(jsonb)` direct permissions were verified closed; the protected `service_role` route remains available. Security controls may need additional adjustments for paid-customer replication. Keep pending offline items intact while tightening Storage policies.

### 7. Work rules for the next chat
1. Begin by reopening `mikelifesfood/RBH` **main**, the newest project README and both November 15 docs; inspect current Supabase RBH deployment if a backend change is proposed. Do not assume this handoff freezes files against newer commits.
2. Start with **Safety Pulse live QA**, then **repeat-hazard/job-site drill-down** if QA is clean. This is the next practical code build; no new large architecture project during basic UI polish.
3. For every change, state exact changed/new/deleted paths; whether GitHub, Supabase SQL, Edge Function, Cloudflare/hosting or browser deployment is involved; preserve roles; verify with tests.
4. Prefer changes-only ZIP when applicable, but direct GitHub commits are acceptable. Keep changes focused and reversible, with rollback commit/migration and acceptance checklist.
5. No secrets in documents, logs or frontend code beyond intentionally public publishable keys/site keys. No changes to unrelated personal repositories/projects.
6. Work autonomously on approved items; ask only for a material business decision, missing credentials, risky/destructive operation or acceptance test requiring the user's device.
7. Distinguish **implemented**, **source-verified**, **user-tested**, and **not yet tested**. Do not claim full security or go-live readiness solely from static inspection.

### 8. Suggested next-chat kickoff
> Continue TeamWorkt Safety / RBH from the November 15, 2026 handoff. Use `mikelifesfood/RBH` on main and Supabase `owhkxguiavgxzwvbxevj` only. First verify Safety Pulse is at the bottom of Home and QA the metrics and responsive layout. Then build the next approved job-site / repeated-hazard drill-down without changing existing four-stage workflow, role permissions, intake, notifications or exports. Follow the prioritized backlog and update exact changed files, migration requirements, tests and handoff statuses as you go. Do not ask questions unless a decision or concern requires my input.

### 9. Reference links and release notes
- GitHub repository: https://github.com/mikelifesfood/RBH
- Dashboard: https://mikelifesfood.github.io/RBH/dashboard.html
- Safety Pulse move-to-bottom commit: https://github.com/mikelifesfood/RBH/commit/c77235482d92dfc29b6ba946d3836eb870db3c0c
- Safety Pulse feature commit: https://github.com/mikelifesfood/RBH/commit/d5027ee61e64e38d65395d3213d78c781b55fdc3
- Build 7 handoff: https://github.com/mikelifesfood/RBH/blob/main/docs/TEAMWORKT_BUILD7_SECURITY_HANDOFF_2026-11-15.md
- Safety Pulse documentation: https://github.com/mikelifesfood/RBH/blob/main/docs/TEAMWORKT_SAFETY_PULSE_2026-11-15.md
- Supabase security advisor guidance: https://supabase.com/docs/guides/database/database-linter

**Document note:** This is an updated handoff built from current GitHub/Supabase checks and the original November 14 strategy. The older handoff describes offline and some features as held; the implementation since then changed their status. The next chat must reverify against current code before changing it.