-- TeamWorkt Safety Build 7: staged public anti-abuse gateway.
-- Safe additive migration. Do NOT revoke anon submit_report until full
-- Turnstile rollout, live tests and rollback preparations have passed.
CREATE TABLE IF NOT EXISTS teamworkt_internal.public_intake_rate_limits (
  bucket text PRIMARY KEY CHECK (length(bucket) BETWEEN 1 AND 160),
  used_count integer NOT NULL CHECK (used_count BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE teamworkt_internal.public_intake_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON teamworkt_internal.public_intake_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON teamworkt_internal.public_intake_rate_limits TO service_role;

-- Atomic fixed-window quotas; the Edge Function supplies server-computed
-- bucket identifiers. Each statement locks the same key through UPSERT.
CREATE OR REPLACE FUNCTION public.rbh_guard_public_intake(p_buckets jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  b jsonb;
  k text;
  ceiling integer;
  n integer;
BEGIN
  IF p_buckets IS NULL OR jsonb_typeof(p_buckets)<>'array'
     OR jsonb_array_length(p_buckets)<1 OR jsonb_array_length(p_buckets)>5 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_REQUEST' USING ERRCODE='22023';
  END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(p_buckets)
  LOOP
    k:=b->>'key';
    ceiling:=(b->>'max')::integer;
    IF k IS NULL OR length(k) NOT BETWEEN 1 AND 160
       OR ceiling IS NULL OR ceiling NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'INVALID_RATE_LIMIT_REQUEST' USING ERRCODE='22023';
    END IF;
    INSERT INTO teamworkt_internal.public_intake_rate_limits(bucket,used_count)
    VALUES(k,1)
    ON CONFLICT(bucket) DO UPDATE SET
      used_count=teamworkt_internal.public_intake_rate_limits.used_count+1,
      updated_at=now()
    WHERE teamworkt_internal.public_intake_rate_limits.used_count<ceiling
    RETURNING used_count INTO n;
    IF n IS NULL THEN RAISE EXCEPTION 'INTAKE_RATE_LIMITED' USING ERRCODE='P0001'; END IF;
    n:=NULL;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.rbh_guard_public_intake(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rbh_guard_public_intake(jsonb) TO service_role;

-- The submission UUID is already unguessable. The same payload hash as
-- submit_report prevents a replay from leaking a receipt for another payload.
-- Existing idempotency records must be readable before a *new* Turnstile
-- challenge; tokens are one-use and may have been consumed on lost responses.
CREATE OR REPLACE FUNCTION public.rbh_public_intake_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  k uuid;
  rid uuid;
  ref bigint;
  fingerprint text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
     OR length(p_payload::text)>65536 THEN RETURN NULL; END IF;
  BEGIN
    k:=(p_payload->>'client_submission_key')::uuid;
  EXCEPTION WHEN others THEN RETURN NULL;
  END;
  IF k IS NULL THEN RETURN NULL; END IF;
  fingerprint:=md5((p_payload-'client_submission_key')::text);
  SELECT r.id,r.ref_no INTO rid,ref FROM public.reports r
  WHERE r.client_submission_key=k
    AND r.client_submission_hash=fingerprint;
  IF rid IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',rid,'ref_no',ref,'duplicate',true);
END;
$$;
REVOKE ALL ON FUNCTION public.rbh_public_intake_receipt(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rbh_public_intake_receipt(jsonb) TO service_role;

-- A scheduled/manual cleanup can remove expired fixed-window counters.
-- No anonymous rights; callers must operate as service_role.
CREATE OR REPLACE FUNCTION public.rbh_trim_public_intake_rate_limits()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM teamworkt_internal.public_intake_rate_limits
  WHERE updated_at < now()-interval '2 days';
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.rbh_trim_public_intake_rate_limits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rbh_trim_public_intake_rate_limits() TO service_role;
