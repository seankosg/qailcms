
DO $$
DECLARE
  r RECORD;
  roles_arr text := $arr$ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]$arr$;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'task_management_raw','task_management_import_logs','task_management_import_row_logs','task_management_status_history',
        'abd_items_raw','defect_items_raw',
        'spare_parts_raw','spare_parts_import_logs','spare_parts_sync_log',
        'spare_part_change_log','spare_part_comments','spare_part_custom_fields','spare_part_import_row_logs','spare_part_status_history'
      )
      AND (qual LIKE '%has_any_role%ARRAY[%user%superuser%admin%'
           OR with_check LIKE '%has_any_role%ARRAY[%user%superuser%admin%')
      AND cmd IN ('INSERT','UPDATE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    IF r.cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid(), %s))',
        r.policyname, r.tablename, roles_arr
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (has_any_role(auth.uid(), %s)) WITH CHECK (has_any_role(auth.uid(), %s))',
        r.policyname, r.tablename, roles_arr, roles_arr
      );
    END IF;
  END LOOP;
END $$;
