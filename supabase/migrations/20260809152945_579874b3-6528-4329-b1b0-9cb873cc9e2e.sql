CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _include_agg boolean DEFAULT false)
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
      CASE WHEN _bucket = 'week' THEN date_trunc('week', e.edate)::date ELSE e.edate END AS bucket_iso,
      e.stage, e.field, e.item_id,
      CASE e.stage
        WHEN 'start' THEN 1 WHEN 'rectified' THEN 2 WHEN 'pre_inspection' THEN 4
        WHEN 'dar_inspection' THEN 8 WHEN 'closure' THEN 16 WHEN 'ho' THEN 32 ELSE 0 END AS bit
    FROM base b
    JOIN public.snag_progress_events(_as_of_date, _plan_mode) e ON e.item_id = b.id
    WHERE e.edate BETWEEN _range_start AND _range_end
  ),
  -- 아이템 단위로 스테이지 비트마스크를 먼저 접어 조합 조인 폭발을 막는다.
  im AS (
    SELECT gk, bucket_iso, field, item_id, bit_or(bit) AS mask
    FROM j GROUP BY 1, 2, 3, 4
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
  SELECT im.gk, im.bucket_iso, 'all|' || c.combo,
    count(*) FILTER (WHERE im.field = 'planned')::int,
    count(*) FILTER (WHERE im.field = 'actual')::int
  FROM im
  JOIN combos c ON (im.mask & c.m) <> 0
  WHERE COALESCE(_include_agg, false)
  GROUP BY 1, 2, 3
$function$;