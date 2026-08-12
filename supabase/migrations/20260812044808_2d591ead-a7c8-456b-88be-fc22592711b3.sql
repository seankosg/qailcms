-- 하루 끝(도하) 기준 누계 실적 복원
CREATE OR REPLACE FUNCTION public.tm_cum_actual_at(_task_raw_id uuid, _d date, _fallback numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH h AS (
    SELECT old_value, new_value, changed_at
      FROM public.task_management_status_history
     WHERE task_raw_id = _task_raw_id
       AND field = 'actual_progress'
  ),
  b AS (
    SELECT new_value AS v FROM h
     WHERE (changed_at AT TIME ZONE 'Asia/Qatar')::date <= _d
     ORDER BY changed_at DESC LIMIT 1
  ),
  a AS (
    SELECT old_value AS v FROM h
     WHERE (changed_at AT TIME ZONE 'Asia/Qatar')::date > _d
     ORDER BY changed_at ASC LIMIT 1
  )
  SELECT public.tm_kpi_norm_actual(
    COALESCE(
      (SELECT CASE WHEN btrim(v) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(v)::numeric END FROM b),
      (SELECT CASE WHEN btrim(v) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(v)::numeric END FROM a),
      CASE WHEN EXISTS (SELECT 1 FROM h) THEN 0 ELSE _fallback END
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.tm_cum_actual_at(uuid, date, numeric) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.tm_rows_as_of(date);

CREATE OR REPLACE FUNCTION public.tm_rows_as_of(_as_of date)
 RETURNS TABLE(id uuid, task_no text, main_task_no text, level text, discipline text, category text, plot text, task_name text, risk text, sub_task_desc text, row_type text, status_manual text, plan_start date, plan_end date, plan_days integer, actual_start date, actual_progress numeric, plan_progress numeric, progress_variance numeric, forecast_end date, slip_days integer, auto_judgment text, data_date date, sort_order integer, source_file text, imported_at timestamp with time zone, imported_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, auto_judgment_import text, is_rollup boolean, source_import_log_id uuid, is_active boolean, team text, location text, floor_level text, actual_finish date, actual_duration integer, owner_user_id uuid, hdec_pic_name text, hdec_eng_name text, cum_plan_pct numeric, cum_actual_pct numeric, gap_pct numeric, delay_days integer, alarm_reason text, milestone text, milestone_date date, plan_overdue text, expected_finish date, actual_overdue text, stage_start text, stage_finish text, expected_progress_today numeric, effective_pic text, original_pic text, delegated_from text, is_delegated boolean, tc_actual_pct numeric, tc_plan_pct numeric)
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
      dg.to_pic AS deleg_to, dg.from_pic AS deleg_from,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof) AS tplan,
      public.tm_row_tplan(v.level::text, v.discipline, v.task_no, v.plan_start, v.plan_end, v.plan_days, p.asof - 1) AS tplan_prev,
      public.tm_kpi_norm_actual(v.actual_progress) AS act_n,
      public.tm_cum_actual_at(v.id, p.asof, v.actual_progress) AS act_asof,
      public.tm_cum_actual_at(v.id, p.asof - 1, v.actual_progress) AS act_prev
    FROM public.v_task_management_raw_derived v
    CROSS JOIN p CROSS JOIN th
    LEFT JOIN LATERAL (
      SELECT d.to_pic, d.from_pic
        FROM public.tm_pic_delegations d
       WHERE d.task_raw_id = v.id
         AND d.status = 'active'
         AND p.asof BETWEEN d.start_date AND d.end_date
       ORDER BY d.created_at DESC
       LIMIT 1
    ) dg ON true
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
    c.expected_progress_today,
    COALESCE(c.deleg_to, c.hdec_pic_name) AS effective_pic,
    c.hdec_pic_name AS original_pic,
    c.deleg_from AS delegated_from,
    (c.deleg_to IS NOT NULL) AS is_delegated,
    CASE WHEN c.act_asof IS NULL OR c.act_prev IS NULL THEN NULL ELSE c.act_asof - c.act_prev END AS tc_actual_pct,
    CASE WHEN c.tplan IS NULL OR c.tplan_prev IS NULL THEN NULL ELSE c.tplan - c.tplan_prev END AS tc_plan_pct
  FROM calc c;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_rows_as_of(date) TO authenticated, service_role;