# RBH Build 51 — Intake Safety & Hardening

Date: 2026-10-06

Build 51 is a focused public-intake cleanup based on external review plus a fresh source check. It intentionally avoids adding offline auto-submit or CAPTCHA complexity.

## Changes

1. **Explicit injury / illness selection** — no answer is preselected. The question is first and required.
2. **Injury / illness classification** — a Yes answer sets `report_type` to `Injury / illness`. Only No answers show the near-miss / unsafe-condition / unsafe-work-practice / vehicle-equipment / other choices.
3. **Emergency copy** — tells workers to call 911 and their site supervisor first, then document the event once everyone is safe.
4. **Android-friendly attachments** — separate `Take photo` and `Choose from phone` controls. The chooser has no `capture` attribute.
5. **Attachment hardening** — up to 10 attachments, 10 MB per file after processing. JPEG/PNG/WebP images larger than about 1.6 MB or 2200 px are resized in-browser to a maximum dimension of 2200 px and encoded as JPEG quality 0.82. Unsupported image formats (including HEIC when the browser cannot decode them) are kept as-is if under 10 MB.
6. **Observed time** — defaults to the device's current local date/time with clear instructions to change it if the event was noticed earlier.
7. **Published-source cleanup** — removed `index_old.html`, `dashboard_old.html`, and `dashboard_09182026_v1.html`. Prior versions remain available through Git history.
8. **Pinned dependency** — surviving Supabase JS CDN imports use exact version `2.117.2`.
9. **Injury email wording** — qualifying serious injury / illness / death language now says `immediately, as soon as practically possible`, while retaining the eight-hour outer limit. Redeploy `notify-report` for this wording change.
10. **Low-friction spam reduction** — added an off-screen honeypot to the public intake. CAPTCHA was not added.

## Deliberately deferred

- **Offline draft + automatic background submission:** not added. Automatic submission on reconnect can create unexpected or duplicate records and shared-device privacy issues. If field testing proves connectivity loss is common, implement a local draft with an explicit `Send when connected` user action instead.
- **True server-side public rate limiting:** not added in this build because the current anonymous form calls the existing `submit_report` RPC directly and the repository does not contain the canonical implementation of that RPC. A meaningful server-side rate limit should be introduced by routing anonymous submission through a controlled Edge Function/server endpoint rather than adding a bypassable browser-only limit.

## Deployment

GitHub / frontend changes:
- `index.html`
- `dashboard.html`
- `platform/index.html`
- remove the three historical HTML pages listed above

Supabase Edge Function change:
- redeploy `supabase/functions/notify-report/index.ts`

No SQL migration is required.
