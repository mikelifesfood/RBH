-- RBH / TeamWorkt incremental cleanup applied in the RBH pilot database.
-- Each customer is intended to receive an independent Supabase installation.
-- Removes only the unused and EMPTY legacy platform-wide invite table.
-- Existing historical migrations might still mention this table; do NOT
-- replay the whole legacy migration folder over a hardened customer install.
--
-- Verified ahead of deletion (2026-11-14):
--   0 rows, no application/Edge Function use, no triggers, no external
--   referencing foreign keys or views.
-- The table was removed without CASCADE.
DO $cleanup$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.organization_admin_invites;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ABORT: organization_admin_invites contains % rows',v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.organization_admin_invites'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ABORT: organization_admin_invites has active triggers';
  END IF;
END $cleanup$;
DROP TABLE public.organization_admin_invites RESTRICT;
