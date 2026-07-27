ALTER FUNCTION public.tm_classify_overdue(date,date,integer) SET search_path = public;
ALTER FUNCTION public.tm_expected_finish(date,date,numeric,date) SET search_path = public;

DROP VIEW IF EXISTS public.v_task_management_raw_derived CASCADE;
CREATE VIEW public.v_task_management_raw_derived
WITH (security_invoker = on) AS
WITH cfg AS (SELECT plot, kind, target_date FROM public.tm_milestone_config),
     bd  AS (SELECT COALESCE((SELECT value_int FROM public.tm_alarm_settings WHERE key='warning_buffer_days'), 7) AS buffer_days)
SELECT
  t.*,
  c.target_date AS milestone_date,
  public.tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days) AS plan_overdue,
  public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
  public.tm_classify_overdue(
    public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date),
    c.target_date, bd.buffer_days
  ) AS actual_overdue
FROM public.task_management_raw t
CROSS JOIN bd
LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone;
GRANT SELECT ON public.v_task_management_raw_derived TO authenticated;