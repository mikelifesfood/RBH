-- Build 7 *CUTOVER ONLY* -- intentionally NOT applied during staging.
-- Run only after real Turnstile preview reports (including photos, QR, offline
-- reconnect), emails, blocked token and rollback tests have passed.
-- First set TURNSTILE_ENFORCE=true in Supabase Edge Function Secrets,
-- and verify GET /functions/v1/submit-public-report returns mode=protected.
-- THEN apply this transaction to remove the direct anonymous RPC bypass.
BEGIN;
GRANT EXECUTE ON FUNCTION public.submit_report(jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_report(jsonb) FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
 IF has_function_privilege('anon','public.submit_report(jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.submit_report(jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.submit_report(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'PUBLIC_INTAKE_CUTOVER_PRIVILEGE_TEST_FAILED'; END IF;
END;
$$;
COMMIT;
