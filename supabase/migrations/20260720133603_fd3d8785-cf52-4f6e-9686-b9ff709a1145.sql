CREATE TABLE public.task_schedule_change_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  import_log_id UUID,
  task_raw_id UUID,
  task_no TEXT NOT NULL,
  main_task_no TEXT,
  discipline TEXT,
  team TEXT,
  plot TEXT,
  task_name TEXT,
  hdec_pic_name TEXT,
  hdec_eng_name TEXT,
  source_file TEXT,
  raw_row_no INTEGER,
  plan_start_old_date DATE,
  plan_start_new_date DATE,
  plan_start_diff_days INTEGER,
  plan_start_prev_gap_days INTEGER,
  plan_start_cur_gap_days INTEGER,
  plan_end_old_date DATE,
  plan_end_new_date DATE,
  plan_end_diff_days INTEGER,
  plan_end_prev_gap_days INTEGER,
  plan_end_cur_gap_days INTEGER,
  forecast_end_old_date DATE,
  forecast_end_new_date DATE,
  forecast_end_diff_days INTEGER,
  forecast_end_prev_gap_days INTEGER
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_schedule_change_audit TO authenticated;
GRANT ALL ON public.task_schedule_change_audit TO service_role;

ALTER TABLE public.task_schedule_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read task schedule audit"
ON public.task_schedule_change_audit
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated can insert task schedule audit"
ON public.task_schedule_change_audit
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid() OR public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can manage task schedule audit"
ON public.task_schedule_change_audit
FOR ALL
TO authenticated
USING (public.is_admin_or_super(auth.uid()))
WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE INDEX idx_task_schedule_audit_created_at ON public.task_schedule_change_audit(created_at DESC);
CREATE INDEX idx_task_schedule_audit_task_raw_id ON public.task_schedule_change_audit(task_raw_id);
CREATE INDEX idx_task_schedule_audit_import_log_id ON public.task_schedule_change_audit(import_log_id);