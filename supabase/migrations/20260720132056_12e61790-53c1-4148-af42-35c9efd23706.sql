
CREATE TABLE IF NOT EXISTS public._tm_date_shift_log_20260720 AS
SELECT id, task_no, source_file,
       plan_start, plan_end, actual_start, actual_finish, forecast_end,
       now() AS logged_at
FROM public.task_management_raw;

GRANT SELECT ON public._tm_date_shift_log_20260720 TO service_role;
ALTER TABLE public._tm_date_shift_log_20260720 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public._tm_date_shift_log_20260720;
CREATE POLICY "service role only" ON public._tm_date_shift_log_20260720
  FOR ALL TO service_role USING (true) WITH CHECK (true);

UPDATE public.task_management_raw
SET
  plan_start    = plan_start    + INTERVAL '1 day',
  plan_end      = plan_end      + INTERVAL '1 day',
  actual_start  = actual_start  + INTERVAL '1 day',
  actual_finish = actual_finish + INTERVAL '1 day',
  forecast_end  = forecast_end  + INTERVAL '1 day',
  updated_at    = now();

DO $$
DECLARE d TEXT;
BEGIN
  FOR d IN SELECT DISTINCT discipline FROM public.task_management_raw WHERE discipline IS NOT NULL LOOP
    PERFORM public.rollup_task_all_mains(d);
    PERFORM public.recalc_task_auto_judgment(d);
  END LOOP;
END $$;
