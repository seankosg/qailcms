ALTER FUNCTION public.snag_progress_events(date, text, date, date) ROWS 500000;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(_plan_groups text[], _teams text[], _room_groups text[], _buildings text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH nofilter AS (
    SELECT (COALESCE(cardinality(_plan_groups),0) = 0
        AND COALESCE(cardinality(_teams),0) = 0
        AND COALESCE(cardinality(_room_groups),0) = 0
        AND COALESCE(cardinality(_buildings),0) = 0) AS all_rows
  ),
  base AS MATERIALIZED (
    SELECT r.id
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND NOT (SELECT all_rows FROM nofilter)
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  bend AS (
    SELECT GREATEST(_range_end,
             CASE _bucket
               WHEN 'week' THEN _range_end + 6
               WHEN 'month' THEN (date_trunc('month', _range_end)::date + interval '1 month - 1 day')::date
               ELSE _range_end
             END) AS max_end
  ),
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.snag_progress_events(_as_of_date, _plan_mode, DATE '1900-01-01', (SELECT max_end FROM bend)) e
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  d AS (
    SELECT e.stage, e.field, e.edate AS first_date, count(*)::int AS c
    FROM ev e
    WHERE (SELECT all_rows FROM nofilter)
       OR EXISTS (SELECT 1 FROM base b WHERE b.id = e.item_id)
    GROUP BY 1,2,3
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
           CASE _bucket
             WHEN 'week' THEN (g::date + 6)
             WHEN 'month' THEN (date_trunc('month', g)::date + interval '1 month - 1 day')::date
             ELSE g::date
           END AS bucket_end
    FROM generate_series(
      _range_start::timestamp,
      _range_end::timestamp,
      CASE _bucket
        WHEN 'week' THEN interval '7 day'
        WHEN 'month' THEN interval '1 month'
        ELSE interval '1 day'
      END
    ) g
  ),
  stages(stage) AS (
    VALUES ('start'),('rectified'),('pre_inspection'),('dar_inspection'),('closure'),('ho')
  ),
  grid AS (
    SELECT b.bucket_iso, b.bucket_end, s.stage FROM buckets b CROSS JOIN stages s
  ),
  res AS (
    SELECT g.bucket_iso, g.stage,
      COALESCE(sum(d.c) FILTER (WHERE d.field = 'planned'), 0)::int AS cum_plan,
      COALESCE(sum(d.c) FILTER (WHERE d.field = 'actual'), 0)::int AS cum_actual
    FROM grid g
    LEFT JOIN d ON d.stage = g.stage AND d.first_date <= g.bucket_end
    GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_iso', res.bucket_iso,
           'stage', res.stage,
           'cum_plan', res.cum_plan,
           'cum_actual', res.cum_actual
         ) ORDER BY res.stage, res.bucket_iso), '[]'::jsonb)
  FROM res;
$function$;