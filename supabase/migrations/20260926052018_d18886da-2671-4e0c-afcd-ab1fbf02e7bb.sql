CREATE OR REPLACE VIEW public.spl_precedence_violations AS
WITH grid AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.sort_order,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any,
         (p.item_id IS NOT NULL) AS has_row
  FROM public.spl_items i
  CROSS JOIN public.spl_stage_catalog c
  LEFT JOIN public.spl_stage_progress p
    ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active
    AND c.actual_authority = 'HDEC'
    AND c.value_type <> 'flag'
    AND NOT c.chain_excluded
),
scored AS (
  SELECT g.*,
         count(*) FILTER (WHERE g.actual_any IS NULL) OVER (
           PARTITION BY g.item_id ORDER BY g.sort_order
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         )::int AS missing_predecessors,
         count(*) FILTER (WHERE g.actual_any IS NULL AND g.has_row) OVER (
           PARTITION BY g.item_id ORDER BY g.sort_order
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         )::int AS rows_present
  FROM grid g
)
SELECT
  CASE WHEN s.rows_present = 0 THEN 'import_incomplete' ELSE 'precedence' END AS violation_type,
  s.item_id, i.spl_number, i.plot, i.team,
  s.stage_code, s.label, s.sort_order, s.actual_any AS actual_date,
  s.missing_predecessors,
  CASE WHEN s.rows_present = 0
       THEN '선행 단계 자료 미유입 (progress 행 자체 부재)'
       ELSE '선행 단계 실적 없이 후행 실적 존재' END AS detail
FROM scored s
JOIN public.spl_items i ON i.id = s.item_id
WHERE s.actual_any IS NOT NULL
  AND s.missing_predecessors > 0;

GRANT SELECT ON public.spl_precedence_violations TO authenticated;
GRANT ALL ON public.spl_precedence_violations TO service_role;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(
  _plan_groups text[], _teams text[], _room_groups text[], _buildings text[],
  _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT GREATEST(
      _range_end,
      CASE _bucket
        WHEN 'week' THEN _range_end + 6
        WHEN 'month' THEN (date_trunc('month', _range_end)::date + interval '1 month - 1 day')::date
        ELSE _range_end
      END
    ) AS max_end
  ),
  base AS MATERIALIZED (
    SELECT r.planned_start_date psd, r.planned_rectified_date pcd,
      r.planned_pre_inspection_date ppd, r.planned_dar_inspection_date pdd,
      r.planned_closure_date pxd, r.planned_ho_date phd,
      r.actual_start_date asd, r.actual_rectified_date acd,
      r.actual_pre_inspection_date apd, r.actual_dar_inspection_date add_,
      r.actual_closure_date axd, r.actual_ho_date ahd
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  events AS (
    SELECT 'start'::text stage,
      CASE WHEN _plan_mode = 'remaining' AND asd IS NOT NULL
             AND public._snag_done_asof('start', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN asd ELSE psd END AS planned_dt,
      psd AS planned_raw, asd AS actual_dt FROM base
    UNION ALL SELECT 'rectified',
      CASE WHEN _plan_mode = 'remaining' AND acd IS NOT NULL
             AND public._snag_done_asof('rectified', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN acd ELSE pcd END, pcd, acd FROM base
    UNION ALL SELECT 'pre_inspection',
      CASE WHEN _plan_mode = 'remaining' AND apd IS NOT NULL
             AND public._snag_done_asof('pre_inspection', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN apd ELSE ppd END, ppd, apd FROM base
    UNION ALL SELECT 'dar_inspection',
      CASE WHEN _plan_mode = 'remaining' AND add_ IS NOT NULL
             AND public._snag_done_asof('dar_inspection', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN add_ ELSE pdd END, pdd, add_ FROM base
    UNION ALL SELECT 'closure',
      CASE WHEN _plan_mode = 'remaining' AND axd IS NOT NULL
             AND public._snag_done_asof('closure', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN axd ELSE pxd END, pxd, axd FROM base
    UNION ALL SELECT 'ho',
      CASE WHEN _plan_mode = 'remaining' AND ahd IS NOT NULL
             AND public._snag_done_asof('ho', NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd)
           THEN ahd ELSE phd END, phd, ahd FROM base
  ),
  daily AS MATERIALIZED (
    SELECT stage, dt,
      count(*) FILTER (WHERE kind = 'planned')::bigint AS p,
      count(*) FILTER (WHERE kind = 'actual')::bigint AS a
    FROM (
      SELECT stage, planned_dt AS dt, 'planned'::text AS kind
      FROM events, params
      WHERE planned_raw IS NOT NULL
        AND planned_dt BETWEEN DATE '1900-01-01' AND params.max_end
      UNION ALL
      SELECT stage, actual_dt AS dt, 'actual'::text AS kind
      FROM events, params
      WHERE actual_dt IS NOT NULL
        AND actual_dt BETWEEN DATE '1900-01-01' AND LEAST(params.max_end, _as_of_date)
    ) q
    GROUP BY stage, dt
  ),
  cumulative AS MATERIALIZED (
    SELECT stage, dt,
      sum(p) OVER (PARTITION BY stage ORDER BY dt) AS cp,
      sum(a) OVER (PARTITION BY stage ORDER BY dt) AS ca
    FROM daily
  ),
  buckets AS (
    SELECT g::date AS bucket_iso,
      CASE _bucket
        WHEN 'week' THEN g::date + 6
        WHEN 'month' THEN (date_trunc('month', g)::date + interval '1 month - 1 day')::date
        ELSE g::date
      END AS bucket_end
    FROM generate_series(
      _range_start::timestamp, _range_end::timestamp,
      CASE _bucket WHEN 'week' THEN interval '7 day' WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END
    ) g
  ),
  stages(stage) AS (
    VALUES ('start'), ('rectified'), ('pre_inspection'), ('dar_inspection'), ('closure'), ('ho')
  ),
  result_rows AS (
    SELECT b.bucket_iso, s.stage,
      COALESCE(x.cp, 0)::int AS cum_plan,
      COALESCE(x.ca, 0)::int AS cum_actual
    FROM buckets b CROSS JOIN stages s
    LEFT JOIN LATERAL (
      SELECT c.cp, c.ca
      FROM cumulative c
      WHERE c.stage = s.stage AND c.dt <= b.bucket_end
      ORDER BY c.dt DESC
      LIMIT 1
    ) x ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket_iso', r.bucket_iso,
    'stage', r.stage,
    'cum_plan', r.cum_plan,
    'cum_actual', r.cum_actual
  ) ORDER BY r.stage, r.bucket_iso), '[]'::jsonb)
  FROM result_rows r;
$function$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cum_json(text[], text[], text[], text[], text, date, date, date, text) TO authenticated, service_role;