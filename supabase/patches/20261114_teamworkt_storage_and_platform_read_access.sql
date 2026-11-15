-- RBH / TeamWorkt incremental security patch, applied 2026-11-14 ET.
-- Existing RBH schema ONLY; customer bootstrap requires a separate baseline.
-- This file is source-control documentation of live functions and policy definitions.
-- No secrets stored. Test on a clone before replay.

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
    IF v_created < now() - interval '24 hours' THEN
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
 IF EXISTS (SELECT 1 FROM public.report_attachments a WHERE a.storage_path=p_storage_path) THEN
   RAISE EXCEPTION 'ATTACHMENT_ALREADY_REGISTERED';
 END IF;
 INSERT INTO public.report_attachments
 (report_id,organization_id,storage_path,file_name,mime_type,size_bytes)
 VALUES (p_report_id,v_org,p_storage_path,p_file_name,p_mime_type,p_size_bytes);
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
      AND r.created_at >= now()-interval '24 hours'
      AND r.created_at <= now()+interval '5 minutes'
 ) THEN RETURN false; END IF;
 IF (
   SELECT count(*) FROM storage.objects o
   WHERE o.bucket_id='report-attachments'
     AND o.name LIKE ('reports/' || v_report_id::text || '/%')
 ) >= 10 THEN RETURN false; END IF;
 RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.teamworkt_allow_anonymous_report_upload(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.teamworkt_allow_anonymous_report_upload(text) TO anon;
GRANT EXECUTE ON FUNCTION public.add_attachment(uuid,text,text,text,bigint) TO anon, authenticated;

DROP POLICY IF EXISTS "authenticated upload report files" ON storage.objects;
DROP POLICY IF EXISTS "rbh_anon_upload_report_path_only" ON storage.objects;
DROP POLICY IF EXISTS "teamworkt_platform_admin_read_memberships" ON public.organization_memberships;
CREATE POLICY "teamworkt_platform_admin_read_memberships" ON public.organization_memberships FOR SELECT TO authenticated
USING ((EXISTS ( SELECT 1
   FROM platform_admins pa
  WHERE (pa.user_id = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS "rbh_organizations_select" ON public.organizations;
CREATE POLICY "rbh_organizations_select" ON public.organizations FOR SELECT TO authenticated
USING (((EXISTS ( SELECT 1
   FROM platform_admins pa
  WHERE (pa.user_id = ( SELECT auth.uid() AS uid)))) OR (EXISTS ( SELECT 1
   FROM organization_memberships om
  WHERE ((om.user_id = ( SELECT auth.uid() AS uid)) AND (om.status = 'active'::text) AND (om.organization_id = organizations.id)))) OR (rbh_current_user_active() AND (id = rbh_current_organization_id()))));

DROP POLICY IF EXISTS "teamworkt_anon_upload_existing_recent_report_only" ON storage.objects;
CREATE POLICY "teamworkt_anon_upload_existing_recent_report_only" ON storage.objects FOR INSERT TO anon
WITH CHECK (((bucket_id = 'report-attachments'::text) AND teamworkt_allow_anonymous_report_upload(name)));

DROP POLICY IF EXISTS "teamworkt_authenticated_report_uploads_same_org" ON storage.objects;
CREATE POLICY "teamworkt_authenticated_report_uploads_same_org" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (((bucket_id = 'report-attachments'::text) AND (split_part(name, '/'::text, 1) = 'reports'::text) AND (length(split_part(name, '/'::text, 3)) > 0) AND rbh_current_user_active() AND (EXISTS ( SELECT 1
   FROM reports r
  WHERE (((r.id)::text = split_part(objects.name, '/'::text, 2)) AND (r.organization_id = rbh_current_organization_id()) AND ((rbh_current_app_role() = ANY (ARRAY['admin'::text, 'safety_manager'::text])) OR ((rbh_current_app_role() = 'supervisor'::text) AND ((r.investigator_user_id = ( SELECT auth.uid() AS uid)) OR (r.assigned_user_id = ( SELECT auth.uid() AS uid)) OR (r.report_owner_user_id = ( SELECT auth.uid() AS uid))))))))));

-- Expected results: authenticated managers may attach investigation files to
-- existing same-company reports; anonymous upload paths must be recent,
-- existing reports and stay under the backend 10-file/10 MB ceilings.
-- Platform admins can read membership rows; ordinary company members cannot.
