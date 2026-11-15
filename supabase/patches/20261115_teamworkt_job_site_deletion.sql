-- TeamWorkt Safety Build 3: Admin-only permanent deletion of disposable job sites.
-- The existing reports.job_site_id FK is ON DELETE SET NULL.
-- Existing reports, report location text and other safety records are never deleted.

CREATE OR REPLACE FUNCTION public.rbh_delete_job_site(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
  v_linked integer;
BEGIN
  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid())
    AND p.app_role = 'admin'
    AND p.is_active IS TRUE
    AND p.access_deleted_at IS NULL;

  IF v_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teamworkt_installation_context c
    WHERE c.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.job_sites s
    WHERE s.id = p_id AND s.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer INTO v_linked
  FROM public.reports r
  WHERE r.organization_id = v_org AND r.job_site_id = p_id;

  DELETE FROM public.job_sites s
  WHERE s.id = p_id AND s.organization_id = v_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  RETURN v_linked;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rbh_delete_job_site(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbh_delete_job_site(uuid) TO authenticated;
