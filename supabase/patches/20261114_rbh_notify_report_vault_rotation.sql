-- RBH -> TeamWorkt: rotate report notification webhook credential.
-- Applied live to project owhkxguiavgxzwvbxevj on 2026-11-14.
-- Prerequisites (not in source control):
--   * Edge Function secret WEBHOOK_SECRET_NEXT (same value as Vault)
--   * Vault secret rbh_notify_report_webhook_next
--   * notify-report Edge Function deploy with new-only verification
-- This migration never contains the credential itself.
-- NOTE: The Edge Function must accept the new secret before this trigger is installed.
CREATE OR REPLACE FUNCTION public.notify_new_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'rbh_notify_report_webhook_next'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'NOTIFICATION_WEBHOOK_SECRET_NOT_CONFIGURED';
  END IF;

  PERFORM net.http_post(
    url := 'https://owhkxguiavgxzwvbxevj.supabase.co/functions/v1/notify-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT', 'table', 'reports', 'record', row_to_json(NEW)
    )
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_new_report() FROM PUBLIC, anon, authenticated;

-- Deployment checks (run read-only):
-- select count(*) from vault.secrets where name = 'rbh_notify_report_webhook_next';
-- select pg_get_functiondef('public.notify_new_report()'::regprocedure) like '%vault.decrypted_secrets%';
-- Run an explicit controlled report submission and verify report_notification_events.status='sent'.
-- Rollback: redeploy the previously reviewed Edge Function and restore the
-- previous notify_new_report() definition from a secure backup. Do not restore
-- the old plaintext credential in SQL or commit a secret to a repository.
