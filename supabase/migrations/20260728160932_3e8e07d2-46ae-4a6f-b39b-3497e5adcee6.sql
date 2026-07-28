-- 완료 항목은 Plan Overdue / Actual Overdue 판정 제외
DROP VIEW IF EXISTS public.v_task_management_raw_derived CASCADE;
CREATE VIEW public.v_task_management_raw_derived
WITH (security_invoker = on) AS
WITH cfg AS (SELECT plot, kind, target_date FROM public.tm_milestone_config),
     bd  AS (SELECT COALESCE((SELECT value_int FROM public.tm_alarm_settings WHERE key='warning_buffer_days'), 7) AS buffer_days)
SELECT
  t.*,
  c.target_date AS milestone_date,
  CASE
    WHEN COALESCE(t.actual_progress, 0) >= 1 OR t.actual_finish IS NOT NULL THEN NULL
    ELSE public.tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days)
  END AS plan_overdue,
  public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
  CASE
    WHEN COALESCE(t.actual_progress, 0) >= 1 OR t.actual_finish IS NOT NULL THEN NULL
    ELSE public.tm_classify_overdue(
      public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date),
      c.target_date, bd.buffer_days
    )
  END AS actual_overdue,

  CASE
    WHEN t.actual_start IS NOT NULL AND t.plan_start IS NOT NULL AND t.actual_start > t.plan_start THEN 'completed_late'
    WHEN t.actual_start IS NOT NULL THEN 'completed'
    WHEN t.plan_start IS NULL THEN 'empty'
    WHEN t.plan_start <= COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) THEN 'delay'
    ELSE 'plan'
  END AS stage_start,

  CASE
    WHEN t.actual_finish IS NOT NULL AND t.plan_end IS NOT NULL AND t.actual_finish > t.plan_end THEN 'completed_late'
    WHEN t.actual_finish IS NOT NULL THEN 'completed'
    WHEN t.plan_end IS NOT NULL AND t.plan_end <= COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) THEN 'delay'
    WHEN t.actual_start IS NOT NULL
     AND (t.plan_end IS NULL OR t.plan_end > COALESCE(t.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date)) THEN 'wip'
    WHEN t.plan_end IS NULL THEN 'empty'
    ELSE 'plan'
  END AS stage_finish,

  CASE
    WHEN t.plan_days IS NOT NULL AND t.plan_days > 0
      THEN (1.0::numeric / t.plan_days)
    WHEN t.plan_start IS NOT NULL AND t.plan_end IS NOT NULL AND t.plan_end >= t.plan_start
      THEN (1.0::numeric / GREATEST(1, (t.plan_end - t.plan_start) + 1))
    ELSE NULL
  END AS expected_progress_today

FROM public.task_management_raw t
CROSS JOIN bd
LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone;

GRANT SELECT ON public.v_task_management_raw_derived TO authenticated;