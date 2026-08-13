-- 기간 필터를 내장한 스냅 진도 이벤트 정본(4-인자 변형). 술어는 2-인자 원본과 동일하며
-- 기간 밖 이벤트를 생성하지 않아 계산량만 줄인다. 기존 2-인자 함수는 그대로 유지(호출 모호성 없음).
CREATE OR REPLACE FUNCTION public.snag_progress_events(
  _as_of_date date,
  _plan_mode text,
  _range_start date,
  _range_end date
)
RETURNS TABLE(item_id uuid, stage text, field text, edate date)
LANGUAGE sql
STABLE PARALLEL SAFE
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

-- 매트릭스/차트 셀 집계: 기간 필터 내장 변형을 사용한다(계산식 동일).
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
    JOIN public.snag_progress_events(_as_of_date, _plan_mode, _range_start, _range_end) e ON e.item_id = b.id
  ),
  im AS (
    SELECT gk, bucket_iso, field, item_id, bit_or(bit) AS mask
    FROM j GROUP BY 1, 2, 3, 4
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
  WHERE COALESCE(_include_agg, false)
  GROUP BY 1, 2, 3
$function$;