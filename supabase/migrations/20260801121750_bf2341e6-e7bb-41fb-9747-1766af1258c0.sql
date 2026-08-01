CREATE OR REPLACE FUNCTION public.tm_rows_as_of_json(p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'auto_judgment', r.auto_judgment,
    'actual_progress', r.actual_progress,
    'actual_start', r.actual_start,
    'actual_finish', r.actual_finish,
    'cum_plan_pct', r.cum_plan_pct,
    'cum_actual_pct', r.cum_actual_pct,
    'gap_pct', r.gap_pct,
    'delay_days', r.delay_days,
    'alarm_reason', r.alarm_reason
  )), '[]'::jsonb)
  FROM public.tm_rows_as_of(p_as_of) r;
$$;

GRANT EXECUTE ON FUNCTION public.tm_rows_as_of_json(date) TO authenticated, service_role;