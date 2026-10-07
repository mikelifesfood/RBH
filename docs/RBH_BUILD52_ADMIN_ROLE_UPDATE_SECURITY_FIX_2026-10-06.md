# RBH Build 52 — Admin Role Update Security Fix

Date: 2026-10-06

## Problem

Changing another user's role from the Admin page returned `ROLE_UPDATE_FAILED` with database detail `ADMIN_REQUIRED`.

## Root cause

`admin-manage-user` correctly authenticated the signed-in caller as an Admin and then used the trusted Supabase service-role client to update `profiles.app_role`. The older `rbh_guard_profile_security_fields()` trigger required `rbh_current_app_role() = 'admin'` for every role/access update. A service-role PostgREST operation does not carry the end user's normal `auth.uid()`, so the trigger rejected the already-authorized backend update.

## Fix

`rbh_guard_profile_security_fields()` now permits `auth.role() = 'service_role'` before applying the existing Admin-only browser-user check.

Normal users still cannot bypass role protections. Self-role protection, organization validation, last-active-Admin protection, and Admin audit behavior remain in `admin-manage-user`.

## Validation

Passed:

- `profile_security_trigger_ready = true`
- `service_role_backend_bypass_ready = true`

Functional test passed: changing a test user's role persisted after refresh.
