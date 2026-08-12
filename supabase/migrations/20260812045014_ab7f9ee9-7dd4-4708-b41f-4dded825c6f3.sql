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
    SELECT btrim(new_value)::numeric AS v FROM h
     WHERE btrim(new_value) ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND (changed_at AT TIME ZONE 'Asia/Qatar')::date <= _d
     ORDER BY changed_at DESC LIMIT 1
  ),
  a AS (
    SELECT CASE WHEN btrim(old_value) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(old_value)::numeric ELSE 0 END AS v
      FROM h
     WHERE (changed_at AT TIME ZONE 'Asia/Qatar')::date > _d
     ORDER BY changed_at ASC LIMIT 1
  )
  SELECT public.tm_kpi_norm_actual(
    COALESCE(
      (SELECT v FROM b),
      (SELECT v FROM a),
      CASE WHEN EXISTS (SELECT 1 FROM h) THEN 0 ELSE _fallback END
    )
  );
$$;