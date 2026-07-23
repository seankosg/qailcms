CREATE OR REPLACE FUNCTION public.tm_today_actual(_ids uuid[], _as_of date)
RETURNS TABLE(id uuid, t_actual numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pts AS (
    SELECT c.id, (elem->>'d')::date AS d, (elem->>'v')::numeric AS v
    FROM public.task_progress_chart_cache c
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.actual_points, '[]'::jsonb)) elem
    WHERE c.id = ANY(_ids)
  ),
  today_v AS (
    SELECT id, MAX(v) AS v FROM pts WHERE d <= _as_of GROUP BY id
  ),
  yest_v AS (
    SELECT id, MAX(v) AS v FROM pts WHERE d <= (_as_of - INTERVAL '1 day')::date GROUP BY id
  )
  SELECT u.id, COALESCE(t.v, 0) - COALESCE(y.v, 0) AS t_actual
  FROM unnest(_ids) AS u(id)
  LEFT JOIN today_v t ON t.id = u.id
  LEFT JOIN yest_v y ON y.id = u.id;
$$;

GRANT EXECUTE ON FUNCTION public.tm_today_actual(uuid[], date) TO authenticated;