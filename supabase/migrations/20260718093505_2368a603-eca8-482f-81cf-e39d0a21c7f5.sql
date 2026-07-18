
-- 1) abd_import_logs UPDATE: owner or admin/superuser
DROP POLICY IF EXISTS abd_import_logs_update ON public.abd_import_logs;
CREATE POLICY abd_import_logs_update ON public.abd_import_logs
  FOR UPDATE TO authenticated
  USING (imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()))
  WITH CHECK (imported_by = auth.uid() OR public.is_admin_or_super(auth.uid()));

-- 2) abd_items_raw INSERT/UPDATE: require role
DROP POLICY IF EXISTS abd_items_insert ON public.abd_items_raw;
CREATE POLICY abd_items_insert ON public.abd_items_raw
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user'::app_role,'superuser'::app_role,'admin'::app_role]));

DROP POLICY IF EXISTS abd_items_update ON public.abd_items_raw;
CREATE POLICY abd_items_update ON public.abd_items_raw
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['user'::app_role,'superuser'::app_role,'admin'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['user'::app_role,'superuser'::app_role,'admin'::app_role]));

-- 3) spare_part_change_log: drop weak auth-only insert policy, keep role-based one
DROP POLICY IF EXISTS "sp_change_log auth write" ON public.spare_part_change_log;
