-- ADDITIVE RBH offline pilot-scoping gate. Organization offline remains OFF.
-- Pilot-only is the default even after a future organization opt-in.
-- Intended to let one pre-approved RBH test account validate end to end
-- without exposing offline functions to every RBH staff member.
BEGIN;
ALTER TABLE public.staff_offline_settings
  ADD COLUMN IF NOT EXISTS pilot_only boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS public.staff_offline_pilot_users (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,user_id)
);
ALTER TABLE public.staff_offline_pilot_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_offline_pilot_users FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_offline_pilot_users TO service_role;

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
  SELECT s.enabled AND (
    s.pilot_only IS FALSE OR EXISTS (
      SELECT 1 FROM public.staff_offline_pilot_users pilot
      WHERE pilot.organization_id=v_org AND pilot.user_id=v_actor AND pilot.enabled IS TRUE
    )
  ) INTO v_enabled
  FROM public.staff_offline_settings s
  WHERE s.organization_id=v_org;
  RETURN jsonb_build_object('enabled',coalesce(v_enabled,false),
    'protocolVersion',1,'maxSnapshotAgeHours',24);
END;
$body$;

CREATE OR REPLACE FUNCTION public.rbh_commit_offline_corrective_action(
  p_operation_id uuid,
  p_action_id uuid,
  p_kind text,
  p_note text,
  p_expected_action_updated_at timestamptz,
  p_expected_report_updated_at timestamptz,
  p_expected_generation integer,
  p_expected_reopen_count integer,
  p_expected_action_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','teamworkt_internal'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_action public.report_corrective_actions%ROWTYPE;
  v_report public.reports%ROWTYPE;
  v_hash text;
  v_prior teamworkt_internal.staff_offline_operations%ROWTYPE;
  v_result jsonb;
  v_receipt jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  -- Reject stale/revoked sessions even while a previously issued JWT remains
  -- cryptographically valid. This check must happen before ledger replay.
  IF coalesce(auth.jwt()->>'session_id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NOT EXISTS (
      SELECT 1 FROM auth.sessions s
      WHERE s.id=(auth.jwt()->>'session_id')::uuid
        AND s.user_id=v_uid
        AND (s.not_after IS NULL OR s.not_after > now())
    )
  THEN RAISE EXCEPTION 'OFFLINE_SESSION_NOT_ACTIVE'; END IF;
  IF p_operation_id IS NULL OR p_action_id IS NULL
    OR p_kind IS NULL OR p_kind NOT IN ('submit_action_completion','verify_action','request_action_changes')
    OR p_expected_action_updated_at IS NULL OR p_expected_report_updated_at IS NULL
    OR p_expected_generation IS NULL OR p_expected_reopen_count IS NULL
    OR p_expected_action_status IS NULL OR length(coalesce(p_note,'')) > 5000
  THEN RAISE EXCEPTION 'INVALID_OFFLINE_OPERATION'; END IF;

  -- A hash binds the same operation ID to exactly one immutable request.
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'action',p_action_id,'kind',p_kind,'note',p_note,
    'action_revision',p_expected_action_updated_at,'report_revision',p_expected_report_updated_at,
    'generation',p_expected_generation,'reopen',p_expected_reopen_count,
    'status',p_expected_action_status
  )::text,'UTF8')),'hex');

  -- Even a replay requires current account eligibility. No stale JWT may read a
  -- prior receipt after the RBH account is deactivated or moved to another tenant.
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid;
  IF NOT FOUND OR v_profile.is_active IS DISTINCT FROM TRUE OR v_profile.access_deleted_at IS NOT NULL
  THEN RAISE EXCEPTION 'OFFLINE_ACCESS_REVOKED'; END IF;

  -- Serialize duplicate operation IDs, including retries after lost HTTP responses.
  -- Organization-level OFF is authoritative; when pilot_only is TRUE,
  -- even active authenticated users must also be explicitly allowlisted.
  IF (public.rbh_staff_offline_status()->>'enabled') IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'STAFF_OFFLINE_NOT_ENABLED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text||p_operation_id::text,0));
  SELECT * INTO v_prior
    FROM teamworkt_internal.staff_offline_operations
    WHERE actor_id=v_uid AND operation_id=p_operation_id
    FOR UPDATE;
  IF FOUND THEN
    IF v_prior.actor_role IS DISTINCT FROM v_profile.app_role
      OR v_prior.organization_id IS DISTINCT FROM coalesce(v_profile.current_organization_id,v_profile.organization_id)
      OR v_prior.request_sha256 <> v_hash OR v_prior.action_id <> p_action_id
    THEN RAISE EXCEPTION 'OFFLINE_OPERATION_KEY_REUSED'; END IF;
    -- Return exactly the original receipt: do not repeat any data mutation.
    RETURN v_prior.receipt;
  END IF;

  SELECT * INTO v_action FROM public.report_corrective_actions WHERE id=p_action_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_ACTION_NOT_FOUND'; END IF;
  SELECT * INTO v_report FROM public.reports WHERE id=v_action.report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_REPORT_NOT_FOUND'; END IF;

  IF coalesce(v_profile.current_organization_id,v_profile.organization_id) IS DISTINCT FROM v_report.organization_id
    OR v_action.organization_id IS DISTINCT FROM v_report.organization_id
  THEN RAISE EXCEPTION 'OFFLINE_ORGANIZATION_MISMATCH'; END IF;
  IF v_action.updated_at IS DISTINCT FROM p_expected_action_updated_at
    OR v_report.updated_at IS DISTINCT FROM p_expected_report_updated_at
    OR v_action.workflow_generation IS DISTINCT FROM p_expected_generation
    OR coalesce(v_report.workflow_restart_count,0) <> p_expected_generation
    OR coalesce(v_report.reopen_count,0) <> p_expected_reopen_count
    OR v_action.status IS DISTINCT FROM p_expected_action_status
    OR v_action.retired_at IS NOT NULL
  THEN RAISE EXCEPTION 'OFFLINE_CONFLICT_NEEDS_REVIEW'; END IF;

  -- Existing audited RPCs remain the sole implementation of role and workflow rules.
  IF p_kind='submit_action_completion' THEN
    v_result:=public.rbh_submit_corrective_action_completion(p_action_id,p_note);
  ELSIF p_kind='verify_action' THEN
    v_result:=public.rbh_verify_corrective_action(p_action_id,p_note);
  ELSE
    v_result:=public.rbh_request_corrective_action_changes(p_action_id,p_note);
  END IF;

  -- Guard against future changes to nested RPC behavior: never record a
  -- successful idempotency receipt for a rejected or incomplete transition.
  IF v_result IS NULL OR v_result->>'ok' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'OFFLINE_NESTED_TRANSITION_NOT_COMMITTED'; END IF;

  v_receipt:=jsonb_build_object(
    'ok',true,'committed',true,'operationId',p_operation_id,
    'actionId',p_action_id,'reportId',v_report.id,
    'kind',p_kind,'result',v_result,'committedAt',transaction_timestamp()
  );

  INSERT INTO teamworkt_internal.staff_offline_operations
    (actor_id,operation_id,organization_id,actor_role,action_id,report_id,request_sha256,receipt)
  VALUES (v_uid,p_operation_id,v_report.organization_id,v_profile.app_role,p_action_id,v_report.id,v_hash,v_receipt);
  RETURN v_receipt;
END;
$function$;

COMMIT;
-- DO NOT seed a pilot user or enable an organization without a later explicit approval.
-- Future controlled pilot enablement (manual SQL after approval):
-- INSERT INTO public.staff_offline_pilot_users(organization_id,user_id,enabled)
-- VALUES (<rbh_org_uuid>,<approved_test_actor_uuid>,true)
-- ON CONFLICT(organization_id,user_id) DO UPDATE SET enabled=true,updated_at=now();
-- INSERT INTO public.staff_offline_settings(organization_id,enabled,pilot_only)
-- VALUES (<rbh_org_uuid>,true,true)
-- ON CONFLICT(organization_id) DO UPDATE SET enabled=true,pilot_only=true,updated_at=now();
