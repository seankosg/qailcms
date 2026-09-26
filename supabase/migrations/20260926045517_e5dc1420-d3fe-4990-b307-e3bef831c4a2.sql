CREATE OR REPLACE FUNCTION public.abd_progress_cum_json(_plots text[], _teams text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT r.id
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.abd_progress_events(_as_of_date, _plan_mode, _round) e
    JOIN base b ON b.id = e.item_id
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  firsts AS (
    SELECT item_id, stage, field, min(edate) AS first_date
    FROM ev GROUP BY 1,2,3
  ),
  daily AS (
    SELECT stage, first_date AS d,
           count(*) FILTER (WHERE field = 'planned') AS p,
           count(*) FILTER (WHERE field = 'actual') AS a
    FROM firsts GROUP BY 1,2
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
           CASE WHEN _bucket = 'week' THEN (g::date + 6) ELSE g::date END AS bucket_end
    FROM generate_series(_range_start::timestamp, _range_end::timestamp,
      CASE WHEN _bucket = 'week' THEN interval '7 day' ELSE interval '1 day' END) g
  ),
  stages(stage) AS (
    VALUES ('draft_start'),('draft_finish'),('submission'),('dar'),('approval')
  ),
  pts AS (
    -- 각 버킷 종료일 + 이벤트일 병합 후 누적합
    SELECT s.stage, b.bucket_end AS d, 0::bigint AS p, 0::bigint AS a, b.bucket_iso
    FROM buckets b CROSS JOIN stages s
    UNION ALL
    SELECT stage, d, p, a, NULL::date FROM daily
  ),
  run AS (
    SELECT stage, bucket_iso,
      sum(p) OVER w AS cp, sum(a) OVER w AS ca
    FROM pts
    WINDOW w AS (PARTITION BY stage ORDER BY d, (bucket_iso IS NOT NULL)
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_iso', bucket_iso, 'stage', stage,
           'cum_plan', cp::int, 'cum_actual', ca::int
         ) ORDER BY stage, bucket_iso), '[]'::jsonb)
  FROM run WHERE bucket_iso IS NOT NULL;
$function$;