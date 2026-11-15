-- TeamWorkt Safety Build 5: durable client idempotency + retriable attachment metadata.
-- Existing online anonymous reports without client_submission_key remain supported.
ALTER TABLE public.reports ADD COLUMN client_submission_key uuid;
ALTER TABLE public.reports ADD COLUMN client_submission_hash text;
CREATE UNIQUE INDEX reports_client_submission_key_unique ON public.reports(client_submission_key);
-- A deterministic upload path should not be registered twice, including concurrent retries.
CREATE UNIQUE INDEX report_attachments_storage_path_unique
ON public.report_attachments(storage_path) WHERE storage_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_report(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  new_id uuid;
  new_ref bigint;
  v_observed timestamptz;
  v_injury boolean;
  v_key text;
  v_site_id uuid;
  v_site_name text;
  v_site_code text;
  v_submission_key uuid;
  v_submission_hash text;
  v_existing_hash text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object'
     OR length(payload::text) > 65536
  THEN
    RAISE EXCEPTION 'INVALID_REPORT_PAYLOAD';
  END IF;
  IF payload ? 'client_submission_key' THEN
    IF nullif(payload->>'client_submission_key','') IS NULL THEN
      RAISE EXCEPTION 'INVALID_CLIENT_SUBMISSION_KEY' USING ERRCODE='22023';
    END IF;
    BEGIN
      v_submission_key := (payload->>'client_submission_key')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_CLIENT_SUBMISSION_KEY' USING ERRCODE='22023';
    END;
    v_submission_hash := md5((payload - 'client_submission_key')::text);
    SELECT r.id,r.ref_no,r.client_submission_hash
      INTO new_id,new_ref,v_existing_hash
    FROM public.reports r WHERE r.client_submission_key=v_submission_key;
    IF FOUND THEN
      IF v_existing_hash IS DISTINCT FROM v_submission_hash THEN
        RAISE EXCEPTION 'SUBMISSION_KEY_PAYLOAD_MISMATCH' USING ERRCODE='22023';
      END IF;
      RETURN jsonb_build_object('id',new_id,'ref_no',new_ref,'duplicate',true);
    END IF;
  END IF;
  IF nullif(btrim(coalesce(payload->>'report_type','')),'') IS NULL
     OR length(payload->>'report_type') > 100
     OR nullif(btrim(coalesce(payload->>'description','')),'') IS NULL
     OR length(payload->>'description') > 10000
  THEN
    RAISE EXCEPTION 'REPORT_REQUIRED_FIELDS_INVALID';
  END IF;

  FOR v_key IN
    SELECT unnest(ARRAY[
      'hazard_category','potential_severity','people_involved','immediate_action',
      'suggested_fix','reporter_name','reporter_role','reporter_contact',
      'language','job_site','site_location'
    ])
  LOOP
    IF length(coalesce(payload->>v_key,'')) > 4000 THEN
      RAISE EXCEPTION 'REPORT_FIELD_TOO_LONG';
    END IF;
  END LOOP;
  IF coalesce(payload->>'language','en') NOT IN ('en','es') THEN
    RAISE EXCEPTION 'INVALID_REPORT_LANGUAGE';
  END IF;
  IF payload ? 'involves_injury'
     AND jsonb_typeof(payload->'involves_injury') NOT IN ('boolean','null')
  THEN
    RAISE EXCEPTION 'INVALID_INJURY_FLAG';
  END IF;
  v_injury := coalesce((payload->>'involves_injury')::boolean,false);
  IF nullif(payload->>'observed_at','') IS NOT NULL THEN
    BEGIN
      v_observed := (payload->>'observed_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'INVALID_OBSERVED_AT';
    END;
  END IF;

  v_site_code := nullif(btrim(coalesce(payload->>'site_code','')), '');
  IF v_site_code IS NOT NULL THEN
    IF v_site_code !~ '^[a-f0-9]{32}$' THEN
      RAISE EXCEPTION 'INVALID_OR_INACTIVE_SITE_CODE';
    END IF;
    SELECT s.id,s.name INTO v_site_id,v_site_name
      FROM public.job_sites s
      JOIN public.teamworkt_installation_context ctx
        ON ctx.singleton IS TRUE AND ctx.organization_id=s.organization_id
     WHERE s.public_code=v_site_code AND s.is_active IS TRUE;
    IF v_site_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_OR_INACTIVE_SITE_CODE';
    END IF;
  END IF;

  INSERT INTO public.reports (
    report_type,description,hazard_category,potential_severity,
    people_involved,immediate_action,suggested_fix,
    reporter_name,reporter_role,reporter_contact,language,
    job_site,site_location,observed_at,involves_injury,job_site_id,
    client_submission_key,client_submission_hash
  ) VALUES (
    btrim(payload->>'report_type'),btrim(payload->>'description'),
    nullif(payload->>'hazard_category',''),nullif(payload->>'potential_severity',''),
    nullif(payload->>'people_involved',''),nullif(payload->>'immediate_action',''),
    nullif(payload->>'suggested_fix',''),nullif(payload->>'reporter_name',''),
    nullif(payload->>'reporter_role',''),nullif(payload->>'reporter_contact',''),
    coalesce(nullif(payload->>'language',''),'en'),
    coalesce(v_site_name,nullif(payload->>'job_site','')),nullif(payload->>'site_location',''),
    v_observed,v_injury,v_site_id,
    v_submission_key,v_submission_hash
  )
  ON CONFLICT (client_submission_key) DO NOTHING
  RETURNING id,ref_no INTO new_id,new_ref;
  IF new_id IS NULL THEN
    SELECT r.id,r.ref_no,r.client_submission_hash
      INTO new_id,new_ref,v_existing_hash
    FROM public.reports r WHERE r.client_submission_key=v_submission_key;
    IF new_id IS NULL OR v_existing_hash IS DISTINCT FROM v_submission_hash THEN
      RAISE EXCEPTION 'SUBMISSION_KEY_PAYLOAD_MISMATCH' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('id',new_id,'ref_no',new_ref,'duplicate',true);
  END IF;
  RETURN jsonb_build_object('id',new_id,'ref_no',new_ref,'duplicate',false);
END;
$function$;


CREATE OR REPLACE FUNCTION public.teamworkt_allow_anonymous_report_upload(p_path text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
DECLARE
 v_report_id uuid;
 v_segment text;
BEGIN
 IF p_path IS NULL OR split_part(p_path,'/',1)<>'reports' THEN RETURN false; END IF;
 v_segment:=split_part(p_path,'/',2);
 IF v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR length(split_part(p_path,'/',3))=0
    OR length(p_path)>800
 THEN RETURN false; END IF;
 v_report_id:=v_segment::uuid;
 IF NOT EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id=v_report_id
      AND r.organization_id IS NOT NULL
      AND r.created_at <= now()+interval '5 minutes'
      AND (
        r.created_at >= now()-interval '24 hours'
        OR (
          r.client_submission_key IS NOT NULL
          AND split_part(p_path,'/',3)='offline'
          AND split_part(p_path,'/',4)=r.client_submission_key::text
          AND r.created_at >= now()-interval '90 days'
        )
      )
 ) THEN RETURN false; END IF;
 IF (
   SELECT count(*) FROM storage.objects o
   WHERE o.bucket_id='report-attachments'
     AND o.name LIKE ('reports/' || v_report_id::text || '/%')
 ) >= 10 THEN RETURN false; END IF;
 RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.add_attachment(p_report_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'storage'
AS $function$
DECLARE v_org uuid; v_created timestamptz; v_role text; v_uid uuid; v_report public.reports%rowtype;
BEGIN
 IF p_report_id IS NULL OR p_storage_path IS NULL
    OR p_storage_path NOT LIKE ('reports/' || p_report_id::text || '/%')
    OR length(split_part(p_storage_path,'/',3))=0
    OR p_size_bytes IS NULL OR p_size_bytes<1 OR p_size_bytes>10485760
    OR length(coalesce(p_file_name,''))=0 OR length(p_file_name)>255
 THEN RAISE EXCEPTION 'INVALID_ATTACHMENT'; END IF;

 SELECT r.* INTO v_report FROM public.reports r WHERE r.id=p_report_id;
 IF NOT FOUND OR v_report.organization_id IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND';
 END IF;
 v_org:=v_report.organization_id;
 v_created:=v_report.created_at;
 v_uid:=auth.uid();
 IF coalesce(auth.role(),'')='anon' THEN
    IF v_created < now() - interval '24 hours'
      AND NOT (
        v_report.client_submission_key IS NOT NULL
        AND p_storage_path LIKE (
          'reports/' || p_report_id::text || '/offline/' ||
          v_report.client_submission_key::text || '/%'
        )
        AND v_created >= now() - interval '90 days'
      )
    THEN
      RAISE EXCEPTION 'REPORT_UPLOAD_WINDOW_EXPIRED';
    END IF;
 ELSIF coalesce(auth.role(),'')='authenticated' THEN
    IF v_uid IS NULL OR NOT public.rbh_current_user_active()
       OR v_org IS DISTINCT FROM public.rbh_current_organization_id() THEN
      RAISE EXCEPTION 'ATTACHMENT_ORGANIZATION_MISMATCH';
    END IF;
    v_role:=public.rbh_current_app_role();
    IF v_role NOT IN ('admin','safety_manager')
       AND NOT (v_role='supervisor' AND
         (v_report.investigator_user_id=v_uid OR
          v_report.assigned_user_id=v_uid OR
          v_report.report_owner_user_id=v_uid)) THEN
      RAISE EXCEPTION 'ATTACHMENT_PERMISSION_DENIED';
    END IF;
 ELSE
    RAISE EXCEPTION 'ATTACHMENT_AUTH_ROLE_NOT_SUPPORTED';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM storage.objects o
   WHERE o.bucket_id='report-attachments' AND o.name=p_storage_path
 ) THEN RAISE EXCEPTION 'UPLOADED_FILE_NOT_FOUND'; END IF;
 IF EXISTS (SELECT 1 FROM public.report_attachments a
   WHERE a.storage_path=p_storage_path AND a.report_id=p_report_id
   AND a.file_name=p_file_name AND a.size_bytes=p_size_bytes) THEN
   RETURN; -- retry with identical metadata, already registered
 END IF;
 IF EXISTS (SELECT 1 FROM public.report_attachments a WHERE a.storage_path=p_storage_path) THEN
   RAISE EXCEPTION 'ATTACHMENT_ALREADY_REGISTERED';
 END IF;
 INSERT INTO public.report_attachments
 (report_id,organization_id,storage_path,file_name,mime_type,size_bytes)
 VALUES (p_report_id,v_org,p_storage_path,p_file_name,p_mime_type,p_size_bytes);
END;
$function$;

