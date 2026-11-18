-- STAGED ONLY — safe organization-level staff offline feature gate.
-- Do not enable until complete iPhone/Chrome role, evidence, and session acceptance.
BEGIN;
-- RBH's existing organization ID is already used on reports and profiles; do
-- not assume the optional multi-tenant organizations table has been backfilled.
CREATE TABLE IF NOT EXISTS public.staff_offline_settings (
  organization_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.staff_offline_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_offline_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_offline_settings TO service_role;

CREATE OR REPLACE FUNCTION public.rbh_staff_offline_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth'
AS $body$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_enabled boolean;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT coalesce(p.current_organization_id,p.organization_id)
    INTO v_org
  FROM public.profiles p
  WHERE p.id=v_actor AND p.is_active IS TRUE AND p.access_deleted_at IS NULL;
  IF v_org IS NULL THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
  -- Current live session required for access to an offline snapshot feature.
  IF coalesce(auth.jwt()->>'session_id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR NOT EXISTS(
        SELECT 1 FROM auth.sessions s
        WHERE s.id=(auth.jwt()->>'session_id')::uuid
          AND s.user_id=v_actor
          AND (s.not_after IS NULL OR s.not_after>now())
      )
  THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;
  SELECT s.enabled INTO v_enabled FROM public.staff_offline_settings s
  WHERE s.organization_id=v_org;
  RETURN jsonb_build_object('enabled',coalesce(v_enabled,false),
    'protocolVersion',1,'maxSnapshotAgeHours',24);
END;
$body$;
REVOKE ALL ON FUNCTION public.rbh_staff_offline_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rbh_staff_offline_status() TO authenticated;
COMMIT;

-- By default there are no enabled organizations. No seed INSERT is required.
-- After all acceptance, explicitly enable one organization with controlled approval:
-- INSERT INTO public.staff_offline_settings(organization_id,enabled,updated_by)
-- VALUES (<approved-org-uuid>,true,<approved-admin-uuid>)
-- ON CONFLICT (organization_id) DO UPDATE SET enabled=true,updated_at=now(),updated_by=EXCLUDED.updated_by;
-- Emergency disable: UPDATE public.staff_offline_settings SET enabled=false WHERE organization_id=<approved-org-uuid>;
