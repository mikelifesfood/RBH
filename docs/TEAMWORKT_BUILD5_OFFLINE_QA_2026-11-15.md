# TeamWorkt Safety — Build 5 Offline Drafts & Reports QA
**Date:** November 15, 2026  
**Pilot:** RBH Insulation · `mikelifesfood/RBH` · GitHub Pages public form  
**Current source:** GitHub `main` · public `index.html` · `offline-queue.js` · `sw.js`

## What the user sees
- An editable, automatically saved draft (including optimized photos) on the current browser/device.
- A **Save draft on this device** button. A saved draft is **NOT submitted**.
- A saved/queued outbox list, with Edit/Delete only before the server accepts a report, Retry, and Clear local receipt after completion.
- A form submission **first persists the report and photo blobs to IndexedDB**. Only after that can an online send run. If local persistence fails, an online-only fallback keeps the original reporting capability, but it does not promise offline recovery.
- A queued report says **Saved on this device — NOT SUBMITTED** until a server receipt is saved. If the report reaches Supabase but photo uploads have not finished, the UI displays **Report #… RECEIVED — photos pending**.
- After the report and photos complete, a standard reference number is shown and local report content/photos are removed; a non-sensitive local receipt remains until cleared.
- The service worker caches public form assets and the offline-queue script; it never stores private dashboards, Supabase API responses, photo uploads or POST requests.

## November 15 — Safari test feedback and corrective patch
**Owner-reported failures:** Text draft survived closing/reopening mobile Safari, but photo did not. During airplane mode the form still displayed the old "do not submit until you reconnect" instruction. This means **Build 5 device validation remains OPEN**.

**Corrective code committed to `main`:**
- `offline-queue.js` now reads each File/Blob into an explicit ArrayBuffer plus its filename/type/length before writing IndexedDB, then reads it back to confirm byte length and filename. This avoids relying on WebKit's nested File/Blob persistence and covers *both* drafts and queued reports. Upload reconstructs a Blob; existing legacy queued records with `.blob` remain supported.
- `index.html` restores photos as named File objects from saved bytes, saves immediately after adding attachments, and shows a local photo confirmation only after verification. Saved drafts are serialized in order, preventing overlapping asynchronous saves from overwriting a newly attached photo. If storage fails, a visible warning appears and the user should keep the page open. Previously saved text is preserved and should not be cleared.
- The Build 4 offline-warning script was still potentially served from the prior cache. `sw.js` now uses cache version `rbh-public-shell-v10-20261115`, `skipWaiting()`, and **network-first** retrieval of safe JavaScript assets with query-string normalization for offline fallback. `index.html` uses versioned URLs for `pwa-client.js` and `offline-queue.js`. It does NOT clear IndexedDB or erase pending drafts.
- Mock IndexedDB regression test passed ArrayBuffer photo persistence, queued photo persistence, no submission in airplane mode, one report submission on reconnect, photo upload and sensitive local byte cleanup after receipt.

**Retest only these two failures first, on the same iPhone Safari context:**
1. While online open the public form, refresh once, close and reopen online to allow the new service worker to activate. **Do not delete the site, browser data, cache/storage, or uninstall the app**: that could erase the previously saved text and any pending report. Check the updated form shows the "attachment saved on this device — not submitted" confirmation after adding a NEW test photo.
2. Save draft, close/reopen the **same** Safari context and confirm both text and the NEW photo thumbnail/filename survive. Any missing old photo from the earlier flawed version may need to be reattached; the patch cannot reconstruct bytes that were not stored.
3. Then while online visit the form, enable airplane mode, and confirm the warning now says reports **can be queued on this device**. Submit one fictional report and verify **Saved on this device — NOT SUBMITTED** (without a report number).
4. Reconnect and open the form. Check that it receives exactly one report reference, with photo attached. Keep Build 5 open until owner confirms.

**No Supabase, role or Brevo changes** were needed for these two browser issues.

## QA checklist — real device (owner to perform)
- [ ] **Online baseline:** On iPhone Safari, submit one **TEST ONLY** non-injury report with a photo. Confirm one report reference in the app, one report in the dashboard, exactly one grouped initial-email message addressed to eligible recipients, and the photo visible.
- [ ] **Draft persistence:** Start another report, enter text, set a hazard, add one photo, tap **Save draft on this device**, close and reopen the same Safari/PWA context, and confirm all fields and the photo were restored. Do not switch between Safari and the installed standalone app expecting shared storage.
- [ ] **First offline submission:** Open the form while online at least once. Turn on airplane mode, complete a fictional report with a photo, tap Send. Confirm it says **NOT SUBMITTED**, has **no server reference number**, and appears in Saved reports on this device.
- [ ] **Reconnect while open:** Turn off airplane mode with the page open. Confirm the queued report automatically sends, receives one reference, uploads its photo and disappears from pending state. Do **not** interpret a queued state as a submission.
- [ ] **Reconnect after closing:** Queue a fresh fictional report offline, close the application, reconnect, reopen the *same* browser/PWA and confirm foreground retry sends exactly one report.
- [ ] **Partial upload:** In desktop DevTools throttle the connection or interrupt connectivity during photo upload after the report number is assigned. Verify the UI retains the report number with **photos pending**, then resumes without a second report when reconnected.
- [ ] **QR while disconnected:** Scan an active job-site QR while offline (after app shell has been installed/cached), queue a report and verify the server assigns the correct site on reconnect. Offline site identity may be marked pending verification; the server is authoritative. If the site has been deleted, the report should require editing, not silently change sites.
- [ ] **Delete local unsent report:** Queue a fictional report offline and use **Delete unsent copy**. Confirm it disappears and is never submitted later.
- [ ] **Edit invalid report:** A queued report whose site QR is invalid or retired should show **Needs review — NOT submitted**; use **Edit report** to recover the stored fields and photo and resubmit with a valid site or no site selection.
- [ ] **English and Spanish:** Switch language and verify local draft/outbox/offline text is understandable in both languages; existing form copy remains translated.
- [ ] **Device limits/privacy:** Test a shared iPhone only with fictitious data. IndexedDB is stored within the *specific* Safari/PWA context, may be deleted by the OS or clearing site data, and is not encrypted end-to-end by the app. Never uninstall, clear site storage or switch browsers while reports are pending.
- [ ] **Recovery:** Return online, open the staff Dashboard, and verify the normal four roles, history, CSV/PDF exports, and attachment access are unchanged.

## Backend verification completed
- The RBH `submit_report(jsonb)` RPC now accepts optional `client_submission_key` and `offline_upload_token`. Repeated identical keys return the same report ID/reference; a different payload under the same key is rejected; only one incident INSERT/initial notification occurs.
- Report fingerprint is stored as `client_submission_hash` and is compared server-side.
- Reusable photo retry token is stored in `teamworkt_internal.report_upload_secrets` (non-exposed schema, no anon/authenticated SELECT). Unlike a dashboard-visible report ID or submission key, the private token authorizes the carefully scoped late photo path.
- Existing ordinary anonymous upload restrictions continue to apply to non-offline paths; private offline paths may retry up to 90 days after server receipt, within the existing 10-file limit and report ownership checks.
- Uploaded attachment metadata is idempotent for the same report/path/name/size; unique storage-path index prevents duplicate rows.
- DB tests produced clearly labeled fictional reports **#49** and **#50**. Tests passed identical retry, changed-payload rejection, token mismatch, and valid/invalid delayed token authorization (45-day test performed inside a rolled-back transaction). Do not delete test reports without an explicit cleanup decision.
- JavaScript syntax/source checks and an in-memory IndexedDB/network simulation passed: offline queue save, no submission offline, online send, duplicate-free repeated flush, pending photo retry with same report ID, and draft/photo persistence.
- **Not yet independently verified:** real iOS IndexedDB persistence, actual Storage photo upload end-to-end in Safari, Safari/installed-PWA storage isolation, and delivery behavior during actual intermittent connectivity.

## Deployment and rollback
New/updated source on `main`:
- Updated: `index.html`, `pwa-client.js`, `sw.js`, `offline.html`, `job-site-poster.html`.
- Added: `offline-queue.js`.
- Added migrations: `supabase/patches/20261115_teamworkt_offline_submission_idempotency.sql`, `supabase/patches/20261115_teamworkt_offline_upload_token_isolation.sql`.
- No dashboard role logic, notification Edge Function or native/Xcode changes.
- **Rollback warning:** Do not simply remove `sw.js` on a live installed device. Replace it with a clean-up worker and have installed clients update/unregister and drain caches. Preserve the additive idempotency schema and server functions until queued clients finish; reverting server-side RPC behavior while offline reports remain will create duplicate incident risks.
