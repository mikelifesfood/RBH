-- TeamWorkt / RBH role alignment: managers own and plan reports; supervisors complete assigned actions only.
-- Precondition: no report has legacy investigator_user_id; no data is rewritten.
DO $rbh$
DECLARE
  v_name text;
  v_source text;
  v_old text;
  v_new text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.reports WHERE investigator_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Legacy investigator assignments exist; review before role cutover';
  END IF;
  FOREACH v_name IN ARRAY ARRAY[
    'rbh_save_corrective_action_plan',
    'rbh_activate_corrective_action_plan',
    'rbh_set_corrective_action_decision',
    'rbh_can_manage_corrective_action_plan',
    'rbh_guard_supervisor_report_step_fields'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_source
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=v_name;
    IF v_source IS NULL THEN RAISE EXCEPTION 'Missing function %',v_name; END IF;
    IF v_name IN ('rbh_save_corrective_action_plan','rbh_activate_corrective_action_plan') THEN
      v_old := 'if v_role not in (''admin'',''safety_manager'')' || chr(10) ||
        '     and not (' || chr(10) ||
        '       v_role = ''supervisor''' || chr(10) ||
        '       and v_report.investigator_user_id = v_uid' || chr(10) ||
        '     ) then';
      v_new := 'if v_role not in (''admin'',''safety_manager'') then';
    ELSIF v_name = 'rbh_set_corrective_action_decision' THEN
      v_old := 'if v_role not in (''admin'',''safety_manager'',''supervisor'') then';
      v_new := 'if v_role not in (''admin'',''safety_manager'') then';
    ELSIF v_name = 'rbh_can_manage_corrective_action_plan' THEN
      v_old := 'p.app_role in (''admin'',''safety_manager'')' || chr(10) ||
        '        or (' || chr(10) ||
        '          p.app_role = ''supervisor''' || chr(10) ||
        '          and r.investigator_user_id = auth.uid()' || chr(10) ||
        '        )';
      v_new := 'p.app_role in (''admin'',''safety_manager'')';
    ELSE
      v_old := 'v_is_investigator := old.investigator_user_id is not distinct from v_uid;';
      v_new := 'v_is_investigator := false; -- Legacy separate investigator path disabled';
    END IF;
    IF position(v_old in v_source)=0 THEN RAISE EXCEPTION 'Expected role guard absent: %',v_name; END IF;
    v_source := replace(v_source,v_old,v_new);
    IF v_name='rbh_set_corrective_action_decision' THEN
      v_old := 'if v_role = ''supervisor''' || chr(10) ||
        '     and v_report.investigator_user_id is distinct from v_uid then' || chr(10) ||
        '    raise exception ''INVESTIGATOR_REQUIRED'';' || chr(10) ||
        '  end if;';
      IF position(v_old in v_source)=0 THEN RAISE EXCEPTION 'Legacy decision branch absent'; END IF;
      v_source := replace(v_source,v_old,'-- Only Admin/Safety Manager can decide the corrective-action plan.');
    END IF;
    EXECUTE v_source;
  END LOOP;
END $rbh$;

DROP POLICY IF EXISTS teamworkt_reports_update_authorized_same_org ON public.reports;
CREATE POLICY teamworkt_reports_update_authorized_same_org ON public.reports
  FOR UPDATE TO authenticated
  USING (
    public.rbh_current_user_active()
    AND organization_id=public.rbh_current_organization_id()
    AND (
      public.rbh_current_app_role() IN ('admin','safety_manager')
      OR (
        public.rbh_current_app_role()='supervisor'
        AND assigned_user_id=(SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    public.rbh_current_user_active()
    AND organization_id=public.rbh_current_organization_id()
    AND (
      public.rbh_current_app_role() IN ('admin','safety_manager')
      OR (
        public.rbh_current_app_role()='supervisor'
        AND assigned_user_id=(SELECT auth.uid())
      )
    )
  );
