-- TeamWorkt Build 3 — RBH job-site registry and server-validated QR association.
-- No existing reports are modified. Previous free-text job_site stays intact.
CREATE TABLE public.teamworkt_installation_context (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton IS TRUE),
  organization_id uuid NOT NULL REFERENCES public.organizations(id)
);
ALTER TABLE public.teamworkt_installation_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teamworkt_installation_context FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.teamworkt_installation_context TO service_role;
INSERT INTO public.teamworkt_installation_context (singleton,organization_id)
  SELECT true,min(id) FROM public.organizations HAVING count(*) = 1;
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.teamworkt_installation_context) <> 1 THEN
   RAISE EXCEPTION 'Expected exactly one configured organization for isolated RBH installation';
 END IF;
END $guard$;

CREATE TABLE public.job_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  address text CHECK (address IS NULL OR char_length(address)<=300),
  public_code text NOT NULL UNIQUE CHECK (public_code ~ '^[a-f0-9]{32}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id)
);
CREATE INDEX job_sites_org_name_idx ON public.job_sites(organization_id,name);
ALTER TABLE public.job_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_sites FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.job_sites TO service_role;
ALTER TABLE public.reports ADD COLUMN job_site_id uuid REFERENCES public.job_sites(id) ON DELETE SET NULL;
CREATE INDEX reports_job_site_id_idx ON public.reports(job_site_id);

CREATE OR REPLACE FUNCTION public.rbh_list_job_sites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_org uuid;
BEGIN
 SELECT p.organization_id INTO v_org FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.app_role='admin'
   AND p.is_active IS TRUE AND p.access_deleted_at IS NULL;
 IF v_org IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.teamworkt_installation_context c WHERE c.organization_id=v_org
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'address',s.address,'code',s.public_code,'active',s.is_active
 ) ORDER BY s.is_active DESC,s.name)
 FROM public.job_sites s WHERE s.organization_id=v_org),'[]'::jsonb);
END $fn$;

CREATE OR REPLACE FUNCTION public.rbh_save_job_site(
 p_id uuid,p_name text,p_address text,p_active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_org uuid; v_site public.job_sites%ROWTYPE;
BEGIN
 SELECT p.organization_id INTO v_org FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.app_role='admin'
   AND p.is_active IS TRUE AND p.access_deleted_at IS NULL;
 IF v_org IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.teamworkt_installation_context c WHERE c.organization_id=v_org
 ) THEN RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120
   OR char_length(coalesce(p_address,''))>300 OR p_active IS NULL
 THEN RAISE EXCEPTION 'INVALID_SITE_FIELDS' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO public.job_sites(organization_id,name,address,public_code,is_active,created_by,updated_by)
   VALUES(v_org,btrim(p_name),nullif(btrim(p_address),''),replace(gen_random_uuid()::text,'-',''),p_active,(select auth.uid()),(select auth.uid()))
   RETURNING * INTO v_site;
 ELSE
   UPDATE public.job_sites s SET name=btrim(p_name),address=nullif(btrim(p_address),''),
     is_active=p_active,updated_at=now(),updated_by=(SELECT auth.uid())
   WHERE s.id=p_id AND s.organization_id=v_org RETURNING * INTO v_site;
   IF NOT FOUND THEN RAISE EXCEPTION 'SITE_NOT_FOUND' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN jsonb_build_object('id',v_site.id,'name',v_site.name,'address',v_site.address,
      'code',v_site.public_code,'active',v_site.is_active);
END $fn$;

CREATE OR REPLACE FUNCTION public.rbh_get_job_site(p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT (SELECT jsonb_build_object('name',s.name,'address',s.address,'code',s.public_code)
 FROM public.job_sites s
 JOIN public.teamworkt_installation_context c ON c.organization_id=s.organization_id
 WHERE c.singleton IS TRUE AND s.is_active IS TRUE AND s.public_code=p_code
 AND p_code ~ '^[a-f0-9]{32}$' LIMIT 1);
$fn$;

REVOKE ALL ON FUNCTION public.rbh_list_job_sites() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rbh_save_job_site(uuid,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.rbh_get_job_site(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rbh_list_job_sites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbh_save_job_site(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rbh_get_job_site(text) TO anon,authenticated;

-- Preserve the original submit_report validations and attachment trigger behavior.
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

  v_site_code := nullif(btrim(coalesce(payload->>'site_code','')), '');
  IF v_site_code IS NOT NULL THEN
    IF v_site_code !~ '^[a-f0-9]{32}    report_type,description,hazard_category,potential_severity,
    people_involved,immediate_action,suggested_fix,
    reporter_name,reporter_role,reporter_contact,language,
    job_site,site_location,observed_at,involves_injury,job_site_id
  ) VALUES (
    btrim(payload->>'report_type'),btrim(payload->>'description'),
    nullif(payload->>'hazard_category',''),nullif(payload->>'potential_severity',''),
    nullif(payload->>'people_involved',''),nullif(payload->>'immediate_action',''),
    nullif(payload->>'suggested_fix',''),nullif(payload->>'reporter_name',''),
    nullif(payload->>'reporter_role',''),nullif(payload->>'reporter_contact',''),
    coalesce(nullif(payload->>'language',''),'en'),
    coalesce(v_site_name,nullif(payload->>'job_site','')),nullif(payload->>'site_location',''),
    v_observed,v_injury,v_site_id
  )
  RETURNING id,ref_no INTO new_id,new_ref;
  RETURN jsonb_build_object('id',new_id,'ref_no',new_ref);
END;
$function$
 THEN
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
$function$

