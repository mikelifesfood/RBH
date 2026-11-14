-- RBH / TeamWorkt follow-on hardening. Applied to RBH Supabase 2026-11-14.
-- This is an incremental patch for the existing RBH database, NOT a fresh-install schema.
-- Keep public submit_report/add_attachment RPCs available to anonymous users.

-- Consolidate duplicate profile insert RLS and cache the auth identity.
DROP POLICY IF EXISTS "rbh_phase2_profiles_insert_base" ON public.profiles;
ALTER POLICY "user inserts own profile" ON public.profiles
  WITH CHECK (id = (select auth.uid()));

-- Replace unwrapped auth.uid() in eight existing policies without changing their predicates.
DO $do$
DECLARE p record; v_sql text;
BEGIN
  FOR p IN
    SELECT tablename,policyname,qual FROM pg_policies
    WHERE schemaname='public'
      AND (tablename,policyname) IN (
        ('platform_admins','rbh_platform_admins_select_self'),
        ('organizations','rbh_organizations_select'),
        ('report_user_notifications','rbh_report_user_notifications_select_own'),
        ('report_corrective_actions','rbh_report_corrective_actions_select_org'),
        ('report_corrective_action_audit','rbh_report_corrective_action_audit_select_org'),
        ('admin_user_events','admin_user_events_admin_select'),
        ('rbh_record_presence','rbh_record_presence_select_org'),
        ('rbh_record_change_events','rbh_record_change_events_select_org')
      )
  LOOP
    IF p.qual IS NULL THEN RAISE EXCEPTION 'Expected RLS policy missing for %',p.policyname; END IF;
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (%s)',
      p.policyname,p.tablename,replace(p.qual,'auth.uid()','(select auth.uid())')
    );
  END LOOP;
END $do$;

-- Anonymous users cannot invoke authenticated identity helper functions.
REVOKE EXECUTE ON FUNCTION public.rbh_current_app_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rbh_current_organization_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rbh_current_user_active() FROM PUBLIC, anon;

-- Five prioritized index additions; preserve current indexes until usage warrants review.
CREATE INDEX IF NOT EXISTS teamworkt_feedback_user_fk_idx ON public.app_feedback (user_id);
CREATE INDEX IF NOT EXISTS teamworkt_report_notes_author_fk_idx ON public.report_notes (author_id);
CREATE INDEX IF NOT EXISTS teamworkt_notification_recipient_fk_idx ON public.report_notification_events (recipient_user_id);
CREATE INDEX IF NOT EXISTS teamworkt_corrective_audit_actor_fk_idx ON public.report_corrective_action_audit (actor_id);
CREATE INDEX IF NOT EXISTS teamworkt_user_notification_ack_by_fk_idx ON public.report_user_notifications (acknowledged_by_user_id);

-- In-app notifications: own user, active profile, currently assigned organization.
ALTER POLICY "rbh_report_user_notifications_select_own" ON public.report_user_notifications
USING (
  recipient_user_id=(select auth.uid())
  AND public.rbh_current_user_active()
  AND organization_id=public.rbh_current_organization_id()
);

-- Verification expectations from RBH Supabase after patch:
-- Supabase advisor auth_rls_initplan = 0, multiple_permissive_policies = 0.
-- Anonymous definer-function execution warnings = 2 (public intake functions).
-- RLS tables without policies = 3 (review intentional service-only tables separately).
-- Do not delete or recreate any live data.
