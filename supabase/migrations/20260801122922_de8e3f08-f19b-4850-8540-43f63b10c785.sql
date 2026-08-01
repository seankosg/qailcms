CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(_mode text, _filter_value text, _today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT public.tm_kpi_norm_actual(b.actual_progress) AS act,
      b.actual_start, b.actual_finish, b.plan_start, b.plan_end,
      (b.auto_judgment = '완료') AS is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS is_started_raw,
      b.auto_judgment AS jd
    FROM base b
  )
  SELECT jsonb_build_object(
    'today_count', COUNT(*) FILTER (WHERE NOT is_completed AND (plan_start = _today OR plan_end = _today)),
    'delayed_count', COUNT(*) FILTER (WHERE jd IN ('지연','악화')),
    'upcoming_count', COUNT(*) FILTER (WHERE NOT is_completed AND plan_end IS NOT NULL AND (plan_end - _today) BETWEEN 1 AND 3),
    'in_progress_count', COUNT(*) FILTER (WHERE is_started_raw AND NOT is_completed),
    'completed_count', COUNT(*) FILTER (WHERE is_completed),
    'total_count', COUNT(*)
  ) FROM judged;
$function$;

CREATE OR REPLACE FUNCTION public.tm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.* FROM public.tm_rows_as_of(_today) t
    WHERE CASE WHEN _mode = 'pic' THEN t.hdec_pic_name = _filter_value
               WHEN _mode = 'team' THEN t.team = _filter_value ELSE TRUE END
  ),
  computed AS (
    SELECT b.*,
      (b.auto_judgment = '완료') AS _is_completed,
      (public.tm_kpi_norm_actual(b.actual_progress) > 0 OR b.actual_start IS NOT NULL) AS _is_started_raw,
      b.auto_judgment AS _jd
    FROM base b
  ),
  filtered AS (
    SELECT c.* FROM computed c
    WHERE CASE _bucket
      WHEN 'today' THEN NOT c._is_completed AND (c.plan_start = _today OR c.plan_end = _today)
      WHEN 'delayed' THEN c._jd IN ('지연','악화')
      WHEN 'upcoming' THEN NOT c._is_completed AND c.plan_end IS NOT NULL AND (c.plan_end - _today) BETWEEN 1 AND 3
      WHEN 'in_progress' THEN NOT c._is_completed AND c._is_started_raw
      WHEN 'completed' THEN c._is_completed
      ELSE TRUE END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days, f.created_at,
      f.cum_plan_pct, f.cum_actual_pct, f.gap_pct, f.delay_days, f.team
    FROM filtered f ORDER BY f.task_no NULLS LAST LIMIT _limit OFFSET _offset
  ) sub;
$function$;