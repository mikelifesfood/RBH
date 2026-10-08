# RBH Build 53.1.11 — Final UX Cleanup

Date: 2026-10-07

## Included

- Home Injuries count now represents **open injury reports** only; clicking the tile opens the Inbox filtered to open injuries.
- Home Needs your attention / Recent activity panels use natural height to avoid large empty matched-height panels.
- Recent activity resolves audit email addresses to dashboard-user names when a matching profile exists.
- Customer-facing overdue labels no longer expose internal `escalation 2/3` wording.
- Step 4 has one deliberate Close report action in the Ready to close area instead of a duplicate workflow-header Close button.
- Analytics shows a friendly empty state when no reports exist.
- Admin role copy no longer references the Phase 2 migration.
- `Change` is now `Change owner`.
- Step 1 completion messages now say `Investigation started` to match the button users clicked.
- Safety Inbox exports now read `Export shown reports` and `Export all reports`.
- Profile/Security button labels use clearer sentence-case wording.
- Public intake uses `Choose photo/file` and `Copy report summary` (with Spanish equivalents).
- Platform feedback wording now makes clear that the profile submission path is retired and retained items are historical.
- README now documents the current four-step user workflow and current production-candidate phase.

## Deliberately not changed

- Reopen workflow behavior/copy was not changed. The frontend calls `rbh_reopen_report`, but this repository does not contain that RPC implementation. Validate the deployed database behavior before changing preservation/reset language.
- Native browser date picker.
- Corrective-action lifecycle and fields.
- Email routing and notification logic.
- Database/RLS/RPC schema.
- Help Coach behavior.

## Suggested regression checks

1. Home: open injury count and open-injury filter destination.
2. Home: leave open for 2+ minutes; panels should remain stable and natural height.
3. Step 1: Start investigation and verify success wording / ownership.
4. Step 4: verify only the Ready to close button is present and closes normally.
5. Analytics with zero reports: friendly empty state appears.
6. Safety Inbox export buttons still download the correct CSV scopes.
7. Profile/Security buttons still execute their existing actions.
8. Public intake: camera and file selection work and Copy report summary copies the same content as before.
