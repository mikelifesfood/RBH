# TeamWorkt Safety — Public Intake Anti-Abuse Upgrade (Decision-Ready)
Prepared 2026-11-14. **Not deployed**. No production signup or submission behavior has changed because of this document.

## Reason
The RBH public index.html calls `sb.rpc('submit_report', {payload})` directly. Anyone can call the same RPC with the published anon key. Existing backend field validation, 10 MB bucket file cap, real-report attachment checks, recent-report upload window, and 10 files/report cap help but cannot stop automated high-volume report submissions.

Simply adding CAPTCHA to HTML is insufficient: attackers can bypass the browser and call the public RPC directly.

## Recommended configuration
- Cloudflare Turnstile **Managed** widget: usually noninteractive, and may display an interactive checkbox to suspicious visitors.
- Domain/hostname for the pilot: `mikelifesfood.github.io` (the current GitHub Pages hostname); add the eventual hosted TeamWorkt intake domain when ready.
- The public sitekey goes in the web form; the **private Turnstile secret** stays only in RBH Supabase Edge Function Secrets, e.g. `TURNSTILE_SECRET_KEY`. Never commit or paste the private secret.
- Supabase Edge Function `submit-public-report` with `verify_jwt=false` verifies Turnstile token through Cloudflare Siteverify before calling the existing validated `submit_report(jsonb)` via trusted server-side credentials. Check `success`, action/hostname expectations, token freshness and single-use.
- On successful protected-path regression tests, revoke anonymous EXECUTE on `submit_report(jsonb)` so direct RPC calls cannot bypass Turnstile. The Edge Function still calls it with trusted service role. **Never revoke before the alternate frontend endpoint is deployed and tested.**
- Keep public file uploads compatible, but plan short-lived signed upload URLs and verified report-scoped attachment registration in the next phase; prevent direct arbitrary upload abuse.
- Add operational rate limiting and burst controls on the Edge intake endpoint, preferably using Cloudflare WAF/Turnstile Analytics plus a backend limiter and alerts; distinguish accessibility failures and bot rejections in error messages.
- Test English/Spanish copy, mobile devices, slow networks, Turnstile token expiration/retry, and the GitHub Pages deployment domain.
- Verify legitimate report creation triggers exactly one email notification, and that direct anonymous RPC / invalid or replayed Turnstile tokens are rejected.
- Keep a reviewed rollback plan and apply frontend/Edge/database permission changes in a safe deployment order.

## Next user input needed
Confirm that Managed Turnstile is acceptable for employees submitting anonymously, and configure a new Turnstile widget in Cloudflare. The Turnstile **sitekey** can be safely shared; the secret must be entered directly into Supabase Edge Function Secrets. This change is independent of the RBH Supabase billing plan and does not require an upgrade.

## Separate product decision
Keep one Supabase project per customer (initial architecture) versus central multi-tenant hosting. The current customer-installation blueprint assumes separate customer projects and requires a parameterized baseline. Do not merge these decisions into anti-bot deployment.
