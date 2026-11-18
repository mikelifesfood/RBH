-- TeamWorkt Safety: STAGED ONLY. Not applied to production.
-- Offline corrective-action commit endpoint with atomic revision check & replay ledger.
-- This file requires deployment review, rollback plan, role tests and a client integration.
-- Existing online RPCs remain unchanged. No evidence uploads handled here.
BEGIN;

CREATE TABLE IF NOT EXISTS teamworkt_internal.staff_offline_operations (
  actor_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  actor_role text NOT NULL,
  action_id uuid NOT NULL,
  report_id uuid NOT NULL,
  request_sha256 text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  receipt jsonb NOT NULL,
  PRIMARY KEY (actor_id,operation_id)
);
ALTER TABLE teamworkt_internal.staff_offline_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON teamworkt_internal.staff_offline_operations FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE teamworkt_internal.staff_offline_operations IS
  'Private per-user idempotency ledger for explicitly confirmed offline corrective action transitions.';

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
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_offline_settings os
    WHERE os.organization_id=coalesce(v_profile.current_organization_id,v_profile.organization_id)
      AND os.enabled IS TRUE
  ) THEN RAISE EXCEPTION 'STAFF_OFFLINE_NOT_ENABLED'; END IF;

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

REVOKE ALL ON FUNCTION public.rbh_commit_offline_corrective_action(
  uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbh_commit_offline_corrective_action(
  uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,text
) TO authenticated;
COMMIT;

-- This staged SQL was syntactically dry-run before deployment; do not activate without authorization tests.
