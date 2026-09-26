CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(_plan_groups text[], _teams text[], _room_groups text[], _buildings text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH bend AS MATERIALIZED (
    SELECT GREATEST(_range_end,
             CASE _bucket
               WHEN 'week' THEN _range_end + 6
               WHEN 'month' THEN (date_trunc('month', _range_end)::date + interval '1 month - 1 day')::date
               ELSE _range_end END) AS max_end
  ),
  d AS MATERIALIZED (
    SELECT e.stage, e.edate AS dt,
           count(*) FILTER (WHERE e.field = 'planned')::bigint AS p,
           count(*) FILTER (WHERE e.field = 'actual')::bigint AS a
    FROM public.snag_progress_events(_as_of_date, _plan_mode, DATE '1900-01-01', (SELECT max_end FROM bend),
      _plan_groups, _teams, _room_groups, _buildings) e
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
    GROUP BY 1,2
  ),
  cum AS MATERIALIZED (
    SELECT stage, dt,
           sum(p) OVER (PARTITION BY stage ORDER BY dt) AS cp,
           sum(a) OVER (PARTITION BY stage ORDER BY dt) AS ca
    FROM d
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
           CASE _bucket
             WHEN 'week' THEN (g::date + 6)
             WHEN 'month' THEN (date_trunc('month', g)::date + interval '1 month - 1 day')::date
             ELSE g::date END AS bucket_end
    FROM generate_series(_range_start::timestamp, _range_end::timestamp,
      CASE _bucket WHEN 'week' THEN interval '7 day' WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END) g
  ),
  stages(stage) AS (VALUES ('start'),('rectified'),('pre_inspection'),('dar_inspection'),('closure'),('ho')),
  res AS (
    SELECT b.bucket_iso, s.stage,
           COALESCE(x.cp, 0)::int AS cum_plan, COALESCE(x.ca, 0)::int AS cum_actual
    FROM buckets b CROSS JOIN stages s
    LEFT JOIN LATERAL (
      SELECT c.cp, c.ca FROM cum c
      WHERE c.stage = s.stage AND c.dt <= b.bucket_end
      ORDER BY c.dt DESC LIMIT 1
    ) x ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_iso', res.bucket_iso, 'stage', res.stage,
           'cum_plan', res.cum_plan, 'cum_actual', res.cum_actual
         ) ORDER BY res.stage, res.bucket_iso), '[]'::jsonb)
  FROM res;
$function$;