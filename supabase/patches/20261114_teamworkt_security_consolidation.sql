-- TEAMWORKT / RBH SECURITY CONSOLIDATION, 2026-11-14
-- Source-controlled reconstruction of the live remediation state.
-- Requires the existing RBH base schema. NOT a fresh-install schema.
-- Review and test on an isolated clone before running; live RBH already has these patches.
-- This script intentionally contains NO webhook credentials or stored secrets.

BEGIN;

-- Revoke unnecessary permissions on internal trigger functions.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT DISTINCT p.oid::regprocedure AS signature FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT t.tgisinternal AND n.nspname='public'
 LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); END LOOP;
END $$;
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public;

-- Management functions require authenticated sessions.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
 'rbh_activate_corrective_action_plan','rbh_can_manage_corrective_action_plan','rbh_request_corrective_action_changes','rbh_restart_workflow','rbh_save_corrective_action_plan','rbh_set_corrective_action_verifier','rbh_submit_corrective_action_completion','rbh_verify_corrective_action','rbh_submit_feedback','rbh_update_my_guidance','rbh_update_my_language')
 LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',f.signature); END LOOP;
END $$;

-- Validate public intake and profile-privilege protections.
CREATE OR REPLACE FUNCTION public.add_attachment(p_report_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
DECLARE v_org uuid; v_created timestamptz;
BEGIN
  IF p_report_id IS NULL OR p_storage_path IS NULL
    OR p_storage_path NOT LIKE ('reports/' || p_report_id::text || '/%')
    OR length(split_part(p_storage_path,'/',3)) = 0
    OR p_size_bytes IS NULL OR p_size_bytes < 1 OR p_size_bytes > 10485760
    OR length(coalesce(p_file_name,'')) > 255
  THEN
    RAISE EXCEPTION 'INVALID_ATTACHMENT';
  END IF;

  SELECT r.organization_id, r.created_at INTO v_org,v_created
  FROM public.reports r WHERE r.id=p_report_id;
  IF NOT FOUND OR v_org IS NULL THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND';
  END IF;
  IF v_created < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'REPORT_UPLOAD_WINDOW_EXPIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id='report-attachments' AND o.name=p_storage_path
  ) THEN
    RAISE EXCEPTION 'UPLOADED_FILE_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.report_attachments a WHERE a.storage_path=p_storage_path) THEN
    RAISE EXCEPTION 'ATTACHMENT_ALREADY_REGISTERED';
  END IF;

  INSERT INTO public.report_attachments
    (report_id,organization_id,storage_path,file_name,mime_type,size_bytes)
  VALUES
    (p_report_id,v_org,p_storage_path,p_file_name,p_mime_type,p_size_bytes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rbh_guard_profile_security_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
BEGIN
  -- Trusted user-management Edge Functions use service_role. Ordinary browser
  -- sessions may not assign a company or elevated role to themselves.
  IF coalesce(auth.role(),'') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id IS DISTINCT FROM auth.uid()
       OR NEW.app_role IS DISTINCT FROM 'read_only'
       OR NEW.organization_id IS NOT NULL
       OR NEW.current_organization_id IS NOT NULL
       OR NEW.is_active IS DISTINCT FROM TRUE
    THEN
      RAISE EXCEPTION 'PROFILE_PROVISIONING_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.app_role IS DISTINCT FROM OLD.app_role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.current_organization_id IS DISTINCT FROM OLD.current_organization_id
       OR NEW.access_deleted_at IS DISTINCT FROM OLD.access_deleted_at
       OR NEW.access_deleted_by IS DISTINCT FROM OLD.access_deleted_by
       OR NEW.access_deletion_reason IS DISTINCT FROM OLD.access_deletion_reason
    THEN
      RAISE EXCEPTION 'PROFILE_SECURITY_FIELDS_BACKEND_ONLY';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object'
     OR length(payload::text) > 65536
  THEN
    RAISE EXCEPTION 'INVALID_REPORT_PAYLOAD';
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

  INSERT INTO public.reports (
    report_type,description,hazard_category,potential_severity,
    people_involved,immediate_action,suggested_fix,
    reporter_name,reporter_role,reporter_contact,language,
    job_site,site_location,observed_at,involves_injury
  ) VALUES (
    btrim(payload->>'report_type'),btrim(payload->>'description'),
    nullif(payload->>'hazard_category',''),nullif(payload->>'potential_severity',''),
    nullif(payload->>'people_involved',''),nullif(payload->>'immediate_action',''),
    nullif(payload->>'suggested_fix',''),nullif(payload->>'reporter_name',''),
    nullif(payload->>'reporter_role',''),nullif(payload->>'reporter_contact',''),
    coalesce(nullif(payload->>'language',''),'en'),
    nullif(payload->>'job_site',''),nullif(payload->>'site_location',''),
    v_observed,v_injury
  )
  RETURNING id,ref_no INTO new_id,new_ref;
  RETURN jsonb_build_object('id',new_id,'ref_no',new_ref);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.add_attachment(uuid,text,text,text,bigint) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.add_attachment(uuid,text,text,text,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_report(jsonb) TO anon;

-- Remove old permissive policies and replace with company-scoped policies.
DROP POLICY IF EXISTS "rbh_phase2_reports_select_base" ON public.reports;
DROP POLICY IF EXISTS "rbh_phase2_reports_select_guard" ON public.reports;
DROP POLICY IF EXISTS "reviewers read reports" ON public.reports;
DROP POLICY IF EXISTS "rbh_phase2_reports_update_base" ON public.reports;
DROP POLICY IF EXISTS "rbh_phase2_reports_update_guard" ON public.reports;
DROP POLICY IF EXISTS "reviewers update reports" ON public.reports;
DROP POLICY IF EXISTS "rbh_phase2_profiles_select_base" ON public.profiles;
DROP POLICY IF EXISTS "rbh_phase2_profiles_select_guard" ON public.profiles;
DROP POLICY IF EXISTS "reviewers read profiles" ON public.profiles;
DROP POLICY IF EXISTS "rbh_phase2_profiles_update_base" ON public.profiles;
DROP POLICY IF EXISTS "rbh_phase2_profiles_update_guard" ON public.profiles;
DROP POLICY IF EXISTS "user updates own profile" ON public.profiles;
DROP POLICY IF EXISTS "rbh_phase2_attachments_select_base" ON public.report_attachments;
DROP POLICY IF EXISTS "rbh_phase2_attachments_select_guard" ON public.report_attachments;
DROP POLICY IF EXISTS "reviewers read attachments" ON public.report_attachments;
DROP POLICY IF EXISTS "rbh_phase2_audit_select_base" ON public.report_audit;
DROP POLICY IF EXISTS "rbh_phase2_audit_select_guard" ON public.report_audit;
DROP POLICY IF EXISTS "reviewers read audit" ON public.report_audit;
DROP POLICY IF EXISTS "rbh_phase2_notes_insert_base" ON public.report_notes;
DROP POLICY IF EXISTS "rbh_phase2_notes_insert_guard" ON public.report_notes;
DROP POLICY IF EXISTS "reviewers add notes" ON public.report_notes;
DROP POLICY IF EXISTS "rbh_phase2_notes_select_base" ON public.report_notes;
DROP POLICY IF EXISTS "rbh_phase2_notes_select_guard" ON public.report_notes;
DROP POLICY IF EXISTS "reviewers read notes" ON public.report_notes;
DROP POLICY IF EXISTS "reviewers read report files" ON storage.objects;
DROP POLICY IF EXISTS "anon upload report files" ON storage.objects;
DROP POLICY IF EXISTS "rbh_phase2_profiles_insert_base" ON public.profiles;
CREATE POLICY "rbh_phase2_profiles_insert_base" ON public.profiles FOR INSERT TO authenticated
WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "teamworkt_profiles_select_same_org" ON public.profiles;
CREATE POLICY "teamworkt_profiles_select_same_org" ON public.profiles FOR SELECT TO authenticated
USING (((id = ( SELECT auth.uid() AS uid)) OR (rbh_current_user_active() AND (rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text, 'supervisor'::text, 'read_only'::text])) AND (COALESCE(current_organization_id, organization_id) = rbh_current_organization_id()))));

DROP POLICY IF EXISTS "teamworkt_profiles_update_authorized" ON public.profiles;
CREATE POLICY "teamworkt_profiles_update_authorized" ON public.profiles FOR UPDATE TO authenticated
USING ((rbh_current_user_active() AND ((id = ( SELECT auth.uid() AS uid)) OR ((rbh_current_app_role() = 'admin'::text) AND (COALESCE(current_organization_id, organization_id) = rbh_current_organization_id())))))
WITH CHECK ((rbh_current_user_active() AND ((id = ( SELECT auth.uid() AS uid)) OR ((rbh_current_app_role() = 'admin'::text) AND (COALESCE(current_organization_id, organization_id) = rbh_current_organization_id())))));

DROP POLICY IF EXISTS "user inserts own profile" ON public.profiles;
CREATE POLICY "user inserts own profile" ON public.profiles FOR INSERT TO authenticated
WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "teamworkt_attachment_metadata_read" ON public.report_attachments;
CREATE POLICY "teamworkt_attachment_metadata_read" ON public.report_attachments FOR SELECT TO authenticated
USING ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id()) AND (EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.id = report_attachments.report_id) AND (r.organization_id = rbh_current_organization_id()))))));

DROP POLICY IF EXISTS "teamworkt_audit_read_same_org" ON public.report_audit;
CREATE POLICY "teamworkt_audit_read_same_org" ON public.report_audit FOR SELECT TO authenticated
USING ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id())));

DROP POLICY IF EXISTS "teamworkt_notes_insert_authorized" ON public.report_notes;
CREATE POLICY "teamworkt_notes_insert_authorized" ON public.report_notes FOR INSERT TO authenticated
WITH CHECK ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id()) AND (author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.id = report_notes.report_id) AND (r.organization_id = rbh_current_organization_id()) AND ((rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text])) OR ((rbh_current_app_role() = 'supervisor'::text) AND ((r.investigator_user_id = ( SELECT auth.uid() AS uid)) OR (r.assigned_user_id = ( SELECT auth.uid() AS uid))))))))));

DROP POLICY IF EXISTS "teamworkt_notes_read_same_org" ON public.report_notes;
CREATE POLICY "teamworkt_notes_read_same_org" ON public.report_notes FOR SELECT TO authenticated
USING ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id())));

DROP POLICY IF EXISTS "teamworkt_reports_select_same_org" ON public.reports;
CREATE POLICY "teamworkt_reports_select_same_org" ON public.reports FOR SELECT TO authenticated
USING ((rbh_current_user_active() AND (rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text, 'supervisor'::text, 'read_only'::text])) AND (organization_id = rbh_current_organization_id())));

DROP POLICY IF EXISTS "teamworkt_reports_update_authorized_same_org" ON public.reports;
CREATE POLICY "teamworkt_reports_update_authorized_same_org" ON public.reports FOR UPDATE TO authenticated
USING ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id()) AND ((rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text])) OR ((rbh_current_app_role() = 'supervisor'::text) AND ((investigator_user_id = ( SELECT auth.uid() AS uid)) OR (assigned_user_id = ( SELECT auth.uid() AS uid)))))))
WITH CHECK ((rbh_current_user_active() AND (organization_id = rbh_current_organization_id()) AND ((rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text])) OR ((rbh_current_app_role() = 'supervisor'::text) AND ((investigator_user_id = ( SELECT auth.uid() AS uid)) OR (assigned_user_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "rbh_anon_upload_report_path_only" ON storage.objects;
CREATE POLICY "rbh_anon_upload_report_path_only" ON storage.objects FOR INSERT TO anon
WITH CHECK (((bucket_id = 'report-attachments'::text) AND (split_part(name, '/'::text, 1) = 'reports'::text) AND (split_part(name, '/'::text, 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (length(split_part(name, '/'::text, 3)) > 0)));

DROP POLICY IF EXISTS "rbh_read_own_organization_report_evidence" ON storage.objects;
CREATE POLICY "rbh_read_own_organization_report_evidence" ON storage.objects FOR SELECT TO authenticated
USING (((bucket_id = 'report-attachments'::text) AND (rbh_current_user_active() IS TRUE) AND (EXISTS ( SELECT 1
   FROM reports r
  WHERE (((r.id)::text = split_part(objects.name, '/'::text, 2)) AND (r.organization_id = rbh_current_organization_id()))))));

UPDATE storage.buckets SET file_size_limit=10485760 WHERE id='report-attachments';
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM PUBLIC, anon, authenticated;
COMMIT;
