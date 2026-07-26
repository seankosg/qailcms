
CREATE OR REPLACE FUNCTION public.tm_judge_snapshot_at_date(
  p_data_date date,
  p_task_ids  uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  effective_actual_progress numeric,
  cum_plan_pct numeric,
  cum_actual_pct numeric,
  gap_pct numeric,
  auto_judgment text,
  delay_days integer,
  alarm_reason text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT t.id, t.discipline, t.task_no, t.plan_start, t.plan_end, t.plan_days,
           t.actual_start, t.actual_finish, t.actual_progress, t.data_date
    FROM public.task_management_raw t
    WHERE t.is_active IS NOT FALSE
      AND (p_task_ids IS NULL OR t.id = ANY(p_task_ids))
  ),
  snap AS (
    -- 각 task의 스냅샷에서 as_of 이전 마지막 값 (없으면 null)
    SELECT b.id,
      (
        SELECT (p->>'v')::numeric
        FROM public.task_progress_chart_cache c
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.actual_points, '[]'::jsonb)) p
        WHERE coalesce(c.discipline, '') = coalesce(b.discipline, '')
          AND c.task_no = b.task_no
          AND (p->>'d')::date <= coalesce(p_data_date, current_date)
        ORDER BY (p->>'d')::date DESC
        LIMIT 1
      ) AS snap_v
    FROM base b
  ),
  eff AS (
    SELECT b.*,
      CASE
        WHEN p_data_date IS NULL
          OR p_data_date >= coalesce(b.data_date, current_date)
          THEN b.actual_progress
        WHEN s.snap_v IS NULL THEN 0
        ELSE greatest(0, least(1, s.snap_v))
      END AS eff_actual
    FROM base b LEFT JOIN snap s ON s.id = b.id
  )
  SELECT
    e.id,
    e.eff_actual,
    (d->>'cum_plan_pct')::numeric,
    (d->>'cum_actual_pct')::numeric,
    (d->>'gap_pct')::numeric,
    (d->>'auto_judgment')::text,
    (d->>'delay_days')::integer,
    (d->>'alarm_reason')::text
  FROM eff e,
  LATERAL public.tm_compute_derived(
    e.plan_start, e.plan_end, e.plan_days,
    e.actual_start,
    CASE WHEN e.eff_actual >= 1 THEN e.actual_finish ELSE NULL END,
    e.eff_actual,
    coalesce(p_data_date, e.data_date, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date)
  ) d;
$function$;

GRANT EXECUTE ON FUNCTION public.tm_judge_snapshot_at_date(date, uuid[]) TO authenticated, service_role;
