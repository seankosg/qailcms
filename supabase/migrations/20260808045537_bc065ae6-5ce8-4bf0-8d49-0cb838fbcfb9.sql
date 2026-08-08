CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
 RETURNS SETOF v_task_management_raw_derived
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT COALESCE(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date) AS asof
  ),
  th AS (
    SELECT public.tm_resolve_caution(NULL) AS caution, public.tm_resolve_worsen(NULL) AS worsen
  ),
  calc AS MATERIALIZED (
    SELECT v.*, p.asof, th.caution, th.worsen,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof) AS tplan,
      public.tm_kpi_norm_actual(v.actual_progress) AS act_n
    FROM public.v_task_management_raw_derived v CROSS JOIN p CROSS JOIN th
  )
  SELECT
    c.id, c.task_no, c.main_task_no, c.level, c.discipline, c.category, c.plot, c.task_name,
    c.risk, c.sub_task_desc, c.row_type, c.status_manual, c.plan_start, c.plan_end, c.plan_days,
    c.actual_start, c.actual_progress,
    c.plan_progress, c.progress_variance, c.forecast_end, c.slip_days,
    public.tm_kpi_judgment_g(
      c.act_n,
      c.actual_finish,
      c.actual_start,
      c.plan_start, c.asof,
      CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END,
      c.caution, c.worsen) AS auto_judgment,
    c.data_date, c.sort_order, c.source_file, c.imported_at, c.imported_by, c.created_at, c.updated_at,
    c.auto_judgment_import, c.is_rollup, c.source_import_log_id, c.is_active, c.team, c.location, c.floor_level,
    c.actual_finish,
    c.actual_duration, c.owner_user_id, c.hdec_pic_name, c.hdec_eng_name,
    c.tplan AS cum_plan_pct,
    c.act_n AS cum_actual_pct,
    CASE WHEN c.tplan IS NULL THEN NULL ELSE c.act_n - c.tplan END AS gap_pct,
    c.delay_days,
    c.alarm_reason,
    c.milestone, c.milestone_date, c.plan_overdue, c.expected_finish, c.actual_overdue,
    CASE
      WHEN c.actual_start IS NOT NULL AND c.plan_start IS NOT NULL AND c.actual_start > c.plan_start THEN 'completed_late'
      WHEN c.actual_start IS NOT NULL THEN 'completed'
      WHEN c.plan_start IS NULL THEN 'empty'
      WHEN c.plan_start <= c.asof THEN 'delay'
      ELSE 'plan' END AS stage_start,
    CASE
      WHEN c.actual_finish IS NOT NULL AND c.plan_end IS NOT NULL AND c.actual_finish > c.plan_end THEN 'completed_late'
      WHEN c.actual_finish IS NOT NULL THEN 'completed'
      WHEN c.plan_end IS NOT NULL AND c.plan_end <= c.asof THEN 'delay'
      WHEN c.actual_start IS NOT NULL AND (c.plan_end IS NULL OR c.plan_end > c.asof) THEN 'wip'
      WHEN c.plan_end IS NULL THEN 'empty'
      ELSE 'plan' END AS stage_finish,
    c.expected_progress_today
  FROM calc c;
$function$;