CREATE OR REPLACE FUNCTION public.abd_progress_cells(_plots text[], _teams text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text)
 RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 술어 정본 = public.abd_progress_events(). 드릴다운(abd_items_search 의
  -- stage_plan_range / stage_actual_range op)과 동일 소스를 공유한다. 사본 금지.
  -- 집계 단위 = 문서(item_id) DISTINCT. 드릴다운(abd_progress_cell_ids)이 문서 단위이므로
  -- 주간 버킷에서 같은 문서의 복수 라운드 이벤트가 중복 계수되지 않도록 P/A 동일 적용.
  WITH base AS (
    SELECT r.id,
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
          WHEN 'batch_no' THEN r.batch_no
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  ev AS (
    SELECT * FROM public.abd_progress_events(_as_of_date, _plan_mode, _round)
  )
  SELECT b.gk,
         CASE WHEN _bucket = 'week' THEN date_trunc('week', e.edate)::date ELSE e.edate END,
         e.stage,
         count(DISTINCT e.item_id) FILTER (WHERE e.field = 'planned')::int,
         count(DISTINCT e.item_id) FILTER (WHERE e.field = 'actual')::int
  FROM base b
  JOIN ev e ON e.item_id = b.id
  WHERE e.edate BETWEEN _range_start AND _range_end
  GROUP BY 1,2,3
$function$;