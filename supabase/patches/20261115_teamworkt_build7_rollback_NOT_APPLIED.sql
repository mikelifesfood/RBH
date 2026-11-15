-- Build 7 *EMERGENCY ROLLBACK ONLY* -- intentionally NOT applied.
-- If protected intake fails, restore pre-cutover public submit access first
-- so safety reports can be submitted. Then set TURNSTILE_ENFORCE=false in
-- Supabase Edge Function Secrets; the previously installed PWA must be
-- capable of using the legacy path. This is temporary, not secure go-live.
BEGIN;
GRANT EXECUTE ON FUNCTION public.submit_report(jsonb) TO anon,authenticated;
COMMIT;
-- Confirm response:
-- SELECT has_function_privilege('anon','public.submit_report(jsonb)','EXECUTE');
