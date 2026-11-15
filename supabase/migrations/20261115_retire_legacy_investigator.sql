-- RBH legacy investigator retirement: no new investigator assignments and no supervisor attachment access through that field.
-- Existing data precondition: no legacy investigator assignments.
DO $rbh$
DECLARE v_source text; v_old text; v_new text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.reports WHERE investigator_user_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Legacy investigator rows require review';
 END IF;
 SELECT pg_get_functiondef(p.oid) INTO v_source
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='add_attachment';
 IF v_source IS NULL THEN RAISE EXCEPTION 'add_attachment missing'; END IF;
 v_old := '(v_report.investigator_user_id=v_uid OR' || chr(10) ||
          '          v_report.assigned_user_id=v_uid OR' || chr(10) ||
          '          v_report.report_owner_user_id=v_uid)';
 v_new := '(v_report.assigned_user_id=v_uid)';
 IF position(v_old in v_source)=0 THEN RAISE EXCEPTION 'Expected legacy add_attachment guard absent'; END IF;
 EXECUTE replace(v_source,v_old,v_new);

 SELECT pg_get_functiondef(p.oid) INTO v_source
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='rbh_validate_investigator_assignment';
 IF v_source IS NULL THEN RAISE EXCEPTION 'Investigator assignment validator missing'; END IF;
 v_old := '  select p.app_role, coalesce(p.is_active, true)' || chr(10);
 v_new := '  raise exception ''LEGACY_INVESTIGATOR_ASSIGNMENT_DISABLED'';' || chr(10) || chr(10) ||
          '  select p.app_role, coalesce(p.is_active, true)' || chr(10);
 IF position(v_old in v_source)=0 THEN RAISE EXCEPTION 'Expected investigator validator branch absent'; END IF;
 EXECUTE replace(v_source,v_old,v_new);
END $rbh$;