# TeamWorkt Safety — Build 7 Turnstile Managed rollout / QA
Date: 2026-11-15  
Pilot: RBH Insulation  
Repo: `mikelifesfood/RBH`, branch `main`  
Supabase: `owhkxguiavgxzwvbxevj`

## Current delivery status — STAGED, NOT YET ENFORCED
- Implemented and deployed Supabase Edge Function **`submit-public-report`**, version **4**, `verify_jwt=false` (public request must perform its own verification). The function calls Cloudflare **Siteverify** server-side and checks `success`, challenge age (<=300 seconds), hostname and action `rbh_public_report`.
- SQL migration **`supabase/patches/20261115_teamworkt_build7_intake_rate_limit.sql`** applied: restricted atomic rate limiting, private quota table with RLS, receipt lookup for idempotent retries, manual counter cleanup. Neither anon nor normal authenticated staff can call these internal service-role RPCs.
- Frontend `turnstile-intake.js` is integrated with the normal public form and `offline-queue.js`. The existing uploaded-photo flow (after report reference) and private upload token remain. Challenges are presented **only online and when protected mode is active**. The user can cancel and retain the queued report/photos. Turnstile tokens are not stored locally, and each queued report uses a new challenge when necessary.
- Online-only fallback in `index.html` also passes through the same protection module; staff dashboard unchanged.
- `sw.js` version `rbh-public-shell-v14-20261115` caches the public form and JS shell but never caches security tokens, private Supabase data or API responses.
- **Security is NOT yet enforced**. `TURNSTILE_ENFORCE` has not been configured; direct anon `submit_report(jsonb)` remains available intentionally to preserve RBH safety reporting. GitHub staging flag `STAGING_LEGACY_FALLBACK=true` allows the legacy path. Treat this as a development implementation, not a completed security launch.
- No Turnstile secret or private service role credential is committed. No existing anonymous reporting/QR/offline data, roles, Brevo Edge Functions, report notifications or photo permissions have been deleted or replaced.

## Owner: Cloudflare widget configuration
1. In [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), create a new widget named **RBH Safety Public Reporting**.
2. Choose **Managed** widget mode; restrict hostnames to **`mikelifesfood.github.io`** (hostname only, no protocol or `/RBH` path). This covers the RBH GitHub Pages pilot.
3. Cloudflare supplies a **sitekey** and **secret key**. The sitekey is public; the secret must remain private.
4. Open **RBH Supabase → Edge Functions → Secrets** for project `owhkxguiavgxzwvbxevj`. Add:
   - `TURNSTILE_SITE_KEY` = Cloudflare public sitekey
   - `TURNSTILE_SECRET_KEY` = Cloudflare secret key (paste directly into Supabase; never put it in GitHub or send it through chat)
   - `TURNSTILE_ENFORCE` = `false` initially, or leave unset
   - `TURNSTILE_ALLOWED_HOSTNAME` = `mikelifesfood.github.io` (optional; already the default)
   - `TURNSTILE_ALLOWED_ORIGIN` = `https://mikelifesfood.github.io` (optional; already the default)
5. Confirm the secrets are saved. **Do not activate enforcement yet.** Once the keys exist, the preview route can test the real protected implementation without affecting all employee reports.

## Protected preview (before site-wide cutover)
Open **https://mikelifesfood.github.io/RBH/?build7_preview=1** while online. The frontend asks the Edge Function for `GET /functions/v1/submit-public-report?preview=1`; if keys are configured, it responds with `mode:protected` and a public sitekey. All other ordinary RBH report links still use the original legacy route until cutover.

Important preview cases (use fictional **TEST ONLY** non-injury records, and check email logs):
- [ ] Open preview via iPhone Safari; submit test report; Turnstile widget displays as necessary; receive a report reference; verify exactly one Safety Inbox row and exactly one grouped initial email.
- [ ] Attach a photo, verify the same report reference, and confirm the photo is visible in the Dashboard.
- [ ] Turn on airplane mode, enter a fictional report with a photo, submit offline, verify **NOT SUBMITTED** is shown. Turn off airplane mode, leave/reopen the preview form, complete Turnstile if prompted, and verify one report and one email with all photos.
- [ ] Cancel the widget: report and photos remain queued; retry manually and complete verification.
- [ ] Test English and Spanish, high text size, QR link `?site=<site_code>&build7_preview=1`, and the normal company-wide QR without preview.
- [ ] Test invalid or expired token, wrong hostname/action, and excess-rate request using controlled nonproduction mocks before a live load test. Do not deliberately flood live RBH to trigger limits.
- [ ] Confirm the normal non-preview public form still works while `TURNSTILE_ENFORCE=false`.
- [ ] Confirm unchanged Dashboard permission matrix for Admin, Safety Manager, Supervisor and Read Only, plus notifications and exports.

**Server throttle (protected path only):** 15 attempts per IP-derived bucket per 10 minutes; 40 per hour; 300 global per 10 minutes; atomic database counters. The originating-IP signal is best-effort and may be spoofable if an upstream proxy does not overwrite forwarded headers, so the widget and global cap are essential. It is not a substitute for additional WAF or traffic controls.

**Operational care:** Rate buckets are stored in private `teamworkt_internal.public_intake_rate_limits`. Supabase pg_cron was not installed/verified for this project; `public.rbh_trim_public_intake_rate_limits()` is restricted to service roles and can be invoked by an authorized administrator during scheduled maintenance to prune counters older than 48 hours. Never expose this helper to anonymous clients.

## Coordinated final activation — gated, NOT performed
After real preview tests are documented:
1. Owner sets `TURNSTILE_ENFORCE=true` in RBH Supabase Edge Function Secrets.
2. Verify non-preview `GET /functions/v1/submit-public-report` says `mode:"protected"` and real online/QR/offline report submissions return a reference. Monitor Edge logs and employee verification experience.
3. Run **`supabase/patches/20261115_teamworkt_build7_cutover_NOT_APPLIED.sql`**: grant `submit_report(jsonb)` to the service role, revoke it from `PUBLIC`, `anon` and `authenticated`, and assert those permissions. This blocks direct RPC bypass. Do **not** revoke before the protected endpoint passes actual tests.
4. Change `STAGING_LEGACY_FALLBACK` in `turnstile-intake.js` to `false`, publish updated script/form, bump service-worker cache, and check older installed PWAs can update without clearing their IndexedDB queues.
5. Verify a direct anonymous `/rest/v1/rpc/submit_report` call is denied; valid Turnstile submission succeeds; invalid/expired/replayed token fails; retry with the same idempotent payload does not create a duplicate; exactly one Brevo notification; evidence remains private.
6. If anything fails, first use `supabase/patches/20261115_teamworkt_build7_rollback_NOT_APPLIED.sql` to restore anonymous submission temporarily and set `TURNSTILE_ENFORCE=false`. Revert the frontend static staging fallback if it was disabled. Do not destroy pending local reports.

## Verification already completed (code/mock/database)
- SQL migration applied; a transaction-scoped test confirmed quota `2` rejects attempt `3` and missing UUID returns no receipt. Anonymous and authenticated roles have no EXECUTE on rate limiter or receipt lookup; service_role does.
- Edge deployed v4. JS syntax passed. Mock scenarios: staging default legacy, preview protected, enforcement protected, missing credentials fail closed for preview, valid token succeeds, invalid token/hostname/action/origin fail, rate-limited requests return HTTP 429, idempotent replay reuses existing receipt without another Siteverify call.
- Client module mocked: legacy chooses existing RPC; protected mode triggers widget and calls Edge; failed verification does not fall back to insecure direct RPC. Offline queue integration uses original idempotent submission keys and retains existing photo upload flow.
- Supabase security advisor remains aware of public `submit_report` SECURITY DEFINER (intentional **until cutover**), and warns about service-private RLS tables with no browser policies (intentional). No new anonymous grants were added.
- **Not yet real-life verified:** actual Cloudflare widget in iPhone Safari, actual remote Edge GET/POST (runtime verification inaccessible without account configuration/live test), token challenge UX and deliveries with real keys. Do not label production secure.

## Source changes for Build 7
- New: `supabase/patches/20261115_teamworkt_build7_intake_rate_limit.sql` **applied**
- New: `supabase/functions/submit-public-report/index.ts` **deployed, staged**
- New: `turnstile-intake.js` **deployed via GitHub Pages source**
- Updated: `offline-queue.js`, `index.html`, `sw.js`
- New, **NOT APPLIED:** `supabase/patches/20261115_teamworkt_build7_cutover_NOT_APPLIED.sql`
- New, **NOT APPLIED:** `supabase/patches/20261115_teamworkt_build7_rollback_NOT_APPLIED.sql`
- This QA guide and the main MVP handoff

## References
- Cloudflare: https://developers.cloudflare.com/turnstile/get-started/
- Siteverify: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Explicit rendering: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- Supabase function secrets: https://supabase.com/docs/guides/functions/secrets
