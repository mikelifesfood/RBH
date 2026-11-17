# PWA push implementation — phase 1 checkpoint (2026-11-17)

## Branch and status
- Branch: `feature/rbh-pwa-push-pilot` (not merged)
- Production: **unchanged**. No SQL executed; no Edge Function deployed; no VAPID secrets configured; no push sent.
- Existing emails, in-app bell, public anonymous intake, QR, offline photo/queue, dashboard and weekly digest are unchanged. Weekly digest remains **HOLD**.

## Changes staged
1. `supabase/migrations/20261117_pwa_push_foundation_STAGED_NOT_APPLIED.sql` — new subscription store, unique notification/subscription outbox, default-off global dispatch switch. RLS enabled and client access denied; service-role server access only.
2. `sw.js` — push handler displays only generic notification text (even if the incoming payload contains content); clicks focus/open staff `dashboard.html` only. Public shell caching and offline fetch logic retained, with a cache-version bump.

## Phase 1 static inspection
- [x] Correct repository and staff/public manifests identified.
- [x] Existing worker's public offline cache and dashboard no-cache behavior retained.
- [x] Generic worker alert, no report identifiers or user content in display.
- [x] Same-origin staff-dashboard click destination; no untrusted deep link.
- [x] Default-off schema and no sender/scheduler activation.
- [ ] Run automated worker tests (including browser/service worker environment).
- [ ] Apply reviewed schema to RBH after integration code + RLS tests exist.
- [ ] Implement authenticated subscription API: validate live user/session, active profile, org, endpoint origin/provider, keys, replacement ownership, and disable-on-signout.
- [ ] Implement opt-in controls in signed-in staff dashboard only; explicit tap triggers permission, support detection for installed iOS.
- [ ] Generate VAPID keys out-of-band; private key must only enter Supabase Secrets.
- [ ] Implement trusted sender, event-based outbox, late authorization re-check, bounded retries/expiry, dedupe and kill switch.
- [ ] Run automated isolation/duplicate/auth tests with controlled accounts and sanitized events.
- [ ] Desktop and actual iPhone Home Screen device push tests, plus regression/smoke and release approval.

## Security requirements for next build
- Never trust browser-submitted user/organization identifiers; derive from authenticated session and active profile.
- No Data API access to endpoint/key records or outbox; do not log raw endpoints, keys or payloads.
- Must prevent a shared device from receiving prior user's notifications after logout; implement unsubscribe on logout and server-side revocation before activation.
- Current notification authorization must be re-evaluated at send time. Delayed event or revoked role must not leak content.
- Do not treat push-service acceptance as confirmed display.
- Do not create a live sending trigger or schedule until end-to-end security and pilot acceptance pass.
- Keep any test sends limited to approved RBH test accounts/devices.

## Pilot remaining release gates
Follow `docs/RBH_PWA_PUSH_NOTIFICATIONS_HANDOFF.md` and `docs/RBH_TEAMWORKT_RUNNING_BACKLOG.md`.
Separate existing blockers: Admin expired-session 401 browser check, Supabase privileged-function advisor review, release smoke test, rollback/recovery and go/no-go.
