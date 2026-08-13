CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(_plan_groups text[], _teams text[], _room_groups text[], _buildings text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
 RETURNS jsonb
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
  -- 마지막 버킷 종료일보다 늦은 이벤트는 어떤 누계에도 포함되지 않으므로 계산에서 제외한다.
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.snag_progress_events(
           _as_of_date, _plan_mode, DATE '1900-01-01',
           GREATEST(_range_end,
                    CASE _bucket
                      WHEN 'week' THEN _range_end + 6
                      WHEN 'month' THEN (date_trunc('month', _range_end)::date + interval '1 month - 1 day')::date
                      ELSE _range_end
                    END)
         ) e
    JOIN base b ON b.id = e.item_id
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  firsts AS (
    SELECT item_id, stage, field, min(edate) AS first_date
    FROM ev
    GROUP BY 1,2,3
  ),
  d AS (
    SELECT stage, field, first_date, count(*)::int AS c
    FROM firsts
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