-- SM Progress 매트릭스 하위호환 복구:
-- 문서 단위 집계행(stage='all|...')은 신버전 클라이언트에서만 요청하도록 옵트인 파라미터로 전환한다.
-- (구 배포본 클라이언트는 알 수 없는 stage 토큰을 만나면 렌더 중 예외로 페이지 전체가 실패)
DROP FUNCTION IF EXISTS public.defect_snag_progress_cells_json(text[], text[], text[], text[], text, date, date, date, text);
DROP FUNCTION IF EXISTS public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text);

CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[], _teams text[], _room_groups text[], _group_by text[],
  _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text,
  _include_agg boolean DEFAULT false
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public'
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
      e.stage, e.field, e.item_id
    FROM base b
    JOIN public.snag_progress_events(_as_of_date, _plan_mode) e ON e.item_id = b.id
    WHERE e.edate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage,
    count(DISTINCT item_id) FILTER (WHERE field = 'planned')::int,
    count(DISTINCT item_id) FILTER (WHERE field = 'actual')::int
  FROM j GROUP BY 1, 2, 3
  UNION ALL
  SELECT j.gk, j.bucket_iso, 'all|' || c.combo,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'planned')::int,
    count(DISTINCT j.item_id) FILTER (WHERE j.field = 'actual')::int
  FROM j
  JOIN (VALUES
    ('start'), ('rectified'), ('closure'),
    ('start,rectified'), ('start,closure'), ('rectified,closure'),
    ('start,rectified,closure')
  ) AS c(combo) ON j.stage = ANY(string_to_array(c.combo, ','))
  WHERE COALESCE(_include_agg, false)
  GROUP BY 1, 2, 3
$function$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells_json(
  _plan_groups text[], _teams text[], _room_groups text[], _group_by text[],
  _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text,
  _include_agg boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT group_key, bucket_iso, stage, plan_cnt, actual_cnt
    FROM public.defect_snag_progress_cells(_plan_groups, _teams, _room_groups, _group_by,
      _bucket, _range_start, _range_end, _as_of_date, _plan_mode, _include_agg)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg
$function$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells_json(text[], text[], text[], text[], text, date, date, date, text, boolean) TO authenticated, service_role;