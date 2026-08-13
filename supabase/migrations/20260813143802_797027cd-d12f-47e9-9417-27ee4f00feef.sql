DROP FUNCTION IF EXISTS public.snag_progress_events(date, text, date, date);

CREATE OR REPLACE FUNCTION public.snag_progress_events(
  _as_of_date date,
  _plan_mode text,
  _range_start date,
  _range_end date,
  _plan_groups text[] DEFAULT NULL,
  _teams text[] DEFAULT NULL,
  _room_groups text[] DEFAULT NULL,
  _buildings text[] DEFAULT NULL
)
 RETURNS TABLE(item_id uuid, stage text, field text, edate date)
 LANGUAGE sql
 STABLE PARALLEL SAFE ROWS 200000
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT r.id,
      r.planned_start_date psd, r.planned_rectified_date pcd,
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
  ev AS (
    SELECT b.id, v.stage, v.p, v.a, b.asd, b.acd, b.apd, b.add_, b.axd, b.ahd
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text,     b.psd, b.asd),
      ('rectified',       b.pcd, b.acd),
      ('pre_inspection',  b.ppd, b.apd),
      ('dar_inspection',  b.pdd, b.add_),
      ('closure',         b.pxd, b.axd),
      ('ho',              b.phd, b.ahd)
    ) AS v(stage, p, a)
    WHERE (v.p IS NOT NULL AND v.p BETWEEN _range_start AND _range_end)
       OR (v.a IS NOT NULL AND v.a BETWEEN _range_start AND _range_end)
  )
  SELECT id, stage, 'planned'::text, p FROM ev
  WHERE p IS NOT NULL AND p BETWEEN _range_start AND _range_end
    AND (_plan_mode = 'baseline'
         OR NOT public._snag_done_asof(stage, NULL, asd, acd, axd, NULL, _as_of_date, apd, add_, ahd))
  UNION ALL
  SELECT id, stage, 'actual'::text, a FROM ev
  WHERE a IS NOT NULL AND a BETWEEN _range_start AND _range_end
$function$;

-- cells: 이벤트 정본에 동일 필터를 밀어 넣는다(결과 동일, 스캔량 감소)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _include_agg boolean DEFAULT false, _buildings text[] DEFAULT NULL::text[])
 RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  WITH b0 AS (
    SELECT r.id, r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
      AND (_buildings IS NULL OR cardinality(_buildings) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.building)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_buildings) AS x))
  ),
  base AS (
    SELECT b0.id, (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk
    FROM b0
  ),
  j AS (
    SELECT b.gk,
      CASE _bucket
        WHEN 'week'  THEN date_trunc('week',  e.edate)::date
        WHEN 'month' THEN date_trunc('month', e.edate)::date
        ELSE e.edate
      END AS bucket_iso,
      e.stage, e.field, e.item_id,
      CASE e.stage
        WHEN 'start' THEN 1 WHEN 'rectified' THEN 2 WHEN 'pre_inspection' THEN 4
        WHEN 'dar_inspection' THEN 8 WHEN 'closure' THEN 16 WHEN 'ho' THEN 32 ELSE 0 END AS bit
    FROM base b
    JOIN public.snag_progress_events(_as_of_date, _plan_mode, _range_start, _range_end,
      _plan_groups, _teams, _room_groups, _buildings) e ON e.item_id = b.id
  ),
  im AS (
    SELECT gk, bucket_iso, field, item_id, bit_or(bit) AS mask
    FROM j WHERE COALESCE(_include_agg, false) GROUP BY 1, 2, 3, 4
  ),
  mm AS (
    SELECT gk, bucket_iso, field, mask, count(*)::int AS c
    FROM im GROUP BY 1, 2, 3, 4
  ),
  combos AS (
    SELECT i AS m, (
      SELECT string_agg(st.stage, ',' ORDER BY st.ord)
      FROM unnest(ARRAY['start','rectified','pre_inspection','dar_inspection','closure','ho'])
        WITH ORDINALITY AS st(stage, ord)
      WHERE ((i >> (st.ord - 1)::int) & 1) = 1
    ) AS combo
    FROM generate_series(1, 63) AS i
  )
  SELECT gk, bucket_iso, stage,
    count(DISTINCT item_id) FILTER (WHERE field = 'planned')::int,
    count(DISTINCT item_id) FILTER (WHERE field = 'actual')::int
  FROM j GROUP BY 1, 2, 3
  UNION ALL
  SELECT mm.gk, mm.bucket_iso, 'all|' || c.combo,
    COALESCE(sum(mm.c) FILTER (WHERE mm.field = 'planned'), 0)::int,
    COALESCE(sum(mm.c) FILTER (WHERE mm.field = 'actual'), 0)::int
  FROM mm
  JOIN combos c ON (mm.mask & c.m) <> 0
  GROUP BY 1, 2, 3
$function$;

-- cum: 이벤트 정본에 동일 필터 전달(결과 동일)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cum_json(_plan_groups text[], _teams text[], _room_groups text[], _buildings text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bend AS (
    SELECT GREATEST(_range_end,
             CASE _bucket
               WHEN 'week' THEN _range_end + 6
               WHEN 'month' THEN (date_trunc('month', _range_end)::date + interval '1 month - 1 day')::date
               ELSE _range_end
             END) AS max_end
  ),
  ev AS (
    SELECT e.item_id, e.stage, e.field, e.edate
    FROM public.snag_progress_events(_as_of_date, _plan_mode, DATE '1900-01-01', (SELECT max_end FROM bend),
      _plan_groups, _teams, _room_groups, _buildings) e
    WHERE e.field = 'planned' OR e.edate <= _as_of_date
  ),
  d AS (
    SELECT e.stage, e.field, e.edate AS first_date, count(*)::int AS c
    FROM ev e
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

CREATE INDEX IF NOT EXISTS idx_defect_items_raw_active_plan_group
  ON public.defect_items_raw (plan_group) WHERE is_active;