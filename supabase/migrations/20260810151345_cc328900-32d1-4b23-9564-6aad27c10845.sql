DROP POLICY IF EXISTS "tmr admin write" ON public.task_management_raw;
DROP POLICY IF EXISTS "Admins can delete task_management_raw" ON public.task_management_raw;
DROP POLICY IF EXISTS "User+ can insert task_management_raw" ON public.task_management_raw;
DROP POLICY IF EXISTS "Authenticated can view task_management_raw" ON public.task_management_raw;
DROP POLICY IF EXISTS "tmr read authenticated" ON public.task_management_raw;
DROP POLICY IF EXISTS "User+ can update task_management_raw" ON public.task_management_raw;

DROP POLICY IF EXISTS tmr_select ON public.task_management_raw;
DROP POLICY IF EXISTS tmr_insert ON public.task_management_raw;
DROP POLICY IF EXISTS tmr_update ON public.task_management_raw;
DROP POLICY IF EXISTS tmr_delete ON public.task_management_raw;

CREATE POLICY tmr_select ON public.task_management_raw
  FOR SELECT TO authenticated
  USING (public.rcl_can(auth.uid(), 'TM', id, 'read'));

CREATE POLICY tmr_insert ON public.task_management_raw
  FOR INSERT TO authenticated
  WITH CHECK (public.rcl_can_values('TM', jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name), 'write'));

CREATE POLICY tmr_update ON public.task_management_raw
  FOR UPDATE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TM', id, 'write'))
  WITH CHECK (public.rcl_can_values('TM', jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name), 'write'));

CREATE POLICY tmr_delete ON public.task_management_raw
  FOR DELETE TO authenticated
  USING (public.rcl_can(auth.uid(), 'TM', id, 'delete'));