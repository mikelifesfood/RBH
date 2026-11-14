-- RBH / TeamWorkt feedback privacy cleanup.
-- Applied to RBH Supabase on 2026-11-14.
-- Safe to replay as part of an existing-schema migration.
DROP POLICY IF EXISTS "app_feedback_insert_own" ON public.app_feedback;
DROP POLICY IF EXISTS "app_feedback_select_own_or_admin" ON public.app_feedback;
DROP POLICY IF EXISTS "app_feedback_update_admin" ON public.app_feedback;
DROP POLICY IF EXISTS "teamworkt_feedback_insert_own_org" ON public.app_feedback;
DROP POLICY IF EXISTS "teamworkt_feedback_select_own_org" ON public.app_feedback;
DROP POLICY IF EXISTS "teamworkt_feedback_update_admin_org" ON public.app_feedback;
CREATE POLICY "teamworkt_feedback_insert_own_org" ON public.app_feedback FOR INSERT TO authenticated
WITH CHECK (user_id=(select auth.uid()) AND status='new' AND public.rbh_current_user_active() AND organization_id=public.rbh_current_organization_id());
CREATE POLICY "teamworkt_feedback_select_own_org" ON public.app_feedback FOR SELECT TO authenticated
USING (public.rbh_current_user_active() AND organization_id=public.rbh_current_organization_id() AND (user_id=(select auth.uid()) OR public.rbh_current_app_role()='admin'));
CREATE POLICY "teamworkt_feedback_update_admin_org" ON public.app_feedback FOR UPDATE TO authenticated
USING (public.rbh_current_user_active() AND public.rbh_current_app_role()='admin' AND organization_id=public.rbh_current_organization_id())
WITH CHECK (public.rbh_current_user_active() AND public.rbh_current_app_role()='admin' AND organization_id=public.rbh_current_organization_id());
