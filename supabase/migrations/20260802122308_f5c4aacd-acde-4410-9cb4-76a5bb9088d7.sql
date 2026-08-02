ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS actual_finish_source text;

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_actual_finish_source_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_actual_finish_source_chk
  CHECK (actual_finish_source IS NULL OR actual_finish_source IN ('user','auto','import','forecast','migration'));

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_plan_start_range_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_plan_start_range_chk
  CHECK (plan_start IS NULL OR plan_start BETWEEN DATE '2020-01-01' AND DATE '2035-12-31');

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_plan_end_range_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_plan_end_range_chk
  CHECK (plan_end IS NULL OR plan_end BETWEEN DATE '2020-01-01' AND DATE '2035-12-31');

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_actual_start_range_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_actual_start_range_chk
  CHECK (actual_start IS NULL OR actual_start BETWEEN DATE '2020-01-01' AND DATE '2035-12-31');

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_actual_finish_range_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_actual_finish_range_chk
  CHECK (actual_finish IS NULL OR actual_finish BETWEEN DATE '2020-01-01' AND DATE '2035-12-31');

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS tm_raw_forecast_end_range_chk;
ALTER TABLE public.task_management_raw
  ADD CONSTRAINT tm_raw_forecast_end_range_chk
  CHECK (forecast_end IS NULL OR forecast_end BETWEEN DATE '2020-01-01' AND DATE '2035-12-31');