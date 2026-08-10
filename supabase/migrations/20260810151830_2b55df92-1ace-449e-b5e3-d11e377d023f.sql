DROP POLICY IF EXISTS tmr_select ON public.task_management_raw;
CREATE POLICY tmr_select ON public.task_management_raw
  FOR SELECT TO authenticated USING (true);