CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _buildings text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT r.id
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.snag_progress_events(_as_of_date, _plan_mode) e
    JOIN base b ON b.id = e.item_id
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  firsts AS (
    SELECT item_id, stage, field, min(edate) AS first_date
    FROM ev
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
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_iso', gr.bucket_iso,
           'stage', gr.stage,
           'cum_plan', gr.cum_plan,
           'cum_actual', gr.cum_actual
         ) ORDER BY gr.stage, gr.bucket_iso), '[]'::jsonb)
  FROM (
    SELECT g.bucket_iso, g.stage,
      (SELECT count(*) FROM firsts f
        WHERE f.stage = g.stage AND f.field = 'planned' AND f.first_date <= g.bucket_end)::int AS cum_plan,
      (SELECT count(*) FROM firsts f
        WHERE f.stage = g.stage AND f.field = 'actual' AND f.first_date <= g.bucket_end)::int AS cum_actual
    FROM grid g
  ) gr;
$function$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cum_json(text[],text[],text[],text[],text,date,date,date,text) TO authenticated, service_role;