# RBH / TeamWorkt Safety — Offline-First Staff Workflow Programme
**Priority:** P0 / pre-RBH field pilot | **Decision:** Build before UI polish and test-data reset | **Date:** 2026-11-18
**Status:** Architectural discovery completed; implementation remains staged. Do not claim any authenticated staff workflow works offline until its device and service acceptance tests pass.

## Goal / non-negotiable boundaries
Make each step of staff report handling usable in poor reception **without changing existing online behavior, authorization, report records, audit trails, email or push notification semantics**. Existing public intake offline queue is a separate working feature and must not be broken. Offline work is **local draft or pending intent**; server receipt is the only authoritative state change. Do not automatically assign, verify, close, or send workflow emails when the connection returns without explicit user review and submission.

## Findings from live source code
- The public reporter uses `offline-queue.js`, IndexedDB, stored photo byte buffers, and a deduplicated intake submission key. That storage is **not user-scoped**, and must not be reused for privileged staff workflow data.
- `sw.js` caches a narrow non-sensitive public shell, intentionally **does not cache `dashboard.html`**, incident data, Supabase responses or credentials. Offline staff opening/refreshing the dashboard currently falls back to `offline.html`.
- Authenticated `dashboard.html` has no IndexedDB workflow draft/outbox. `localStorage` references are navigation state, not staff work.
- Focused corrective-action completion calls `rbh_submit_corrective_action_completion` RPC directly, and action evidence uploads to `manage-action-evidence` over HTTP. Verification uses online `rbh_verify_corrective_action`; online wizard includes 'Save draft & return home' but it is not local offline persistence.
- Dashboard contains 36 `sb.rpc(...)` calls and multiple online report queries/attachments. Offline is a **cross-workflow architectural project**, not one save button.
- Live RBH push delivery is ON for opted-in staff; email delivery remains live. Never send notifications for a local intent, only for committed server changes.

## Delivery stages — in order; stop at a gate on failure

### Phase 0: Inventory, architecture, and tests (start first)
1. Enumerate each workflow step, its UI save action, RPC/function, server state transition, required fields, upload path, recipient events, permissions and conflict/version signals.
2. Define a supported minimum device/browser matrix for iOS Home Screen PWA, Android Chrome PWA and desktop Chrome/Safari. Test storage eviction, tab closure, device restart, browser update and forced sign-out.
3. Introduce a new **staff-only offline module**; do not reuse `rbh-safety-offline-v1` public reporting database or store raw staff data in `localStorage`.
4. Specify local-only data schema and version upgrades, diagnostic counters that reveal no incident text, and acceptance/rollback procedures.

### Phase 1: Authenticated offline shell + read-only assigned snapshot
1. Make a safely packaged **staff-only static app shell** available offline, with no server credentials/tokens in cache and no unauthorized offline access.
2. After a successful authenticated online session, deliberately stage a *minimal, permission-filtered* snapshot of assigned/open incidents, action metadata, report progress and job-site labels for this tenant/user/device. Do not cache all company reports by default.
3. Sensitive offline material must be access-controlled and encrypted at rest where practical; WebCrypto key handling needs device/OS-specific threat review. A local PIN alone is not encryption. Do not store reusable auth JWTs in the offline database.
4. Locked/expired access must not silently reveal cached incidents. If true offline authentication/revocation cannot be guaranteed, use a reduced non-sensitive read-only view and explicitly document the limitation.
5. On account switch, sign-out, removal of access, or company change, clear the corresponding local snapshot/draft keys. A revoked user whose device never reconnects is a known offline security limitation; enforce cache expiry/minimal data.
6. Display an Offline / Last synced timestamp and a clear limit on unavailable records.

### Phase 2: Durable drafts for every edit surface
Draft locally *before* invoking any network call. Require a visible 'Saved on this device' confirmation **after** IndexedDB transaction finishes, not on optimistic UI state.
- Report review, classification, investigation, root cause, notes, disposition choices.
- Report owner and investigator assignments; corrective plan (multiple actions, ownership, due dates, priority), action completion notes, evidence photos, corrective verification notes and send-back reasons, add-action-before-close, and final closure notes.
- Attachment bytes should be stored explicitly with size/type/hash and verified after write, and blocked with a clear explanation if local storage is full. No private files in Cache Storage or the public reporting database.
- Draft key: `tenant_id:user_id:report_id:action_id:workflow_generation:step` plus draft-schema version and observed server revision. Never confuse users' data on shared devices.
- Local entry should survive app closure, refresh and device restart if OS storage persists. Warn that browsers may evict site data; never promise invulnerable long-term preservation.

### Phase 3: Queue and conflict-safe online submission
1. Separate draft state from a **user-authorized pending operation**. No automatic status transitions, signatures, verification or closure when network returns.
2. Each submitted operation must have stable client operation ID/idempotency key, expected report/action revision and authenticated caller; make corresponding server RPCs atomic and replay-safe using a private ledger and unique key.
3. On reconnect, re-authenticate, confirm tenant, current ownership, role, status, workflow generation, report reopen count and action lifecycle. If changed, mark **Needs review**, show diff/merge/re-entry; never overwrite newer server data.
4. Evidence uploads must be deterministic, resumable, duplicate-safe, and confirmed in Supabase Storage + metadata before marking synchronized; leave local photo until server receipt. Never remove remote attachments on an offline guess.
5. Send email, push and notification-center events only after the server commits the authenticated operation. Use existing idempotency and self-assignment suppression. Exactly-once *effects* require server constraints, not only client retries.
6. Support a user-visible Outbox: Saved locally → Needs connection → Uploading → Pending confirmation → Synced / Needs review / Failed.
7. Signed-out and deactivated users may retain a local *inaccessible* draft only under a documented security and deletion policy; no uploads or retries from stale sessions.

### Phase 4: End-to-end acceptance before pilot
- Account/role/tenant isolation; read-only users cannot write online OR stage unauthorized write intents.
- 0% signal when entering a basement, intermittent signal at 5–50%, refresh/force quit, storage quota, big and multiple image files, time/date changes, session expiry, browser updates.
- Two devices modify the same action; report reassignment while one device offline; verified or closed work while stale draft exists; incident reopened/new generation; action removed; user role revoked.
- Repeat submit/tap, network timeout with server success, failed evidence upload, partial files, duplicate event protection, and no early email/push.
- Full RBH workflows: initial report (existing feature regression), manager review, investigation, ownership, plan, corrective work, verification/send-back, closure; Admin, Safety Manager, Supervisor, Read Only.
- Verify no unauthorized local data appears after account switch, offline direct navigation, PWA cache reinstall or logout.
- Real iPhone Home Screen PWA and Chrome device tests before claiming feature accepted.

## Pilot rollout
- Use a **disabled-by-default organization-level staff-offline feature flag**, with RBH controlled pilot enablement only after security gates. Continue using current online workflow while building.
- Ship phase-by-phase, with automatic database migrations additive only. Never erase reports, users, assignments or storage objects for offline implementation.
- Do **not** reset RBH test data or report numbers until offline MVP, regression and user approvals pass; cleanup belongs to the later prelaunch gate.
- Treat weekly Safety Pulse email digest as explicitly on hold.

## User experience copy
- 'Saved on this device' means persisted locally, **not** sent.
- 'Waiting for connection' means pending user-authorized submission.
- 'Ready to submit' means user review/confirmation required.
- 'Synced to RBH' means server receipt verified.
- 'Needs review' means server data changed or authorization expired.
- 'Not available offline' means the user never opened/synced this record or local permission expired.

## Implementation acceptance definition
A stage is not complete merely because a simulated offline toggle succeeds: it needs signed-in role tests, real browser/device closure-and-reopen recovery, confirmed server idempotency, no stale-state writes, no secrets in caches, and an evidence-backed test record. Maintain a dedicated handoff and don't change RBH live workflow semantics silently.
