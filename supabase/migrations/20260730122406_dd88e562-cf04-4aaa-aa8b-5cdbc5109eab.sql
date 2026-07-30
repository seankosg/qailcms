CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[],
  _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], stage text, total int, done_upto int, plan_upto int, actual_upto int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- 술어 정본 = public.abd_progress_events(). 매트릭스 셀(abd_progress_cells)과
  -- 동일 소스를 공유하며, 집계 단위 = 문서(item_id) DISTINCT 로 통일한다. 사본 금지.
  WITH base AS (
    SELECT r.id,
      (public.abd_judge_v1(r, _as_of_date)->>'active_round')::int AS v_active,
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
  ),
  stages(stage) AS (
    VALUES ('draft_start'),('draft_finish'),('submission'),('dar'),('approval')
  ),
  -- 분모(total): 스테이지 라운드는 활성 라운드 기준 문서 수(라운드 필터 시 해당 라운드 활성 문서),
  -- approval 은 라운드 무관 전체 문서 수.
  tot AS (
    SELECT b.gk, s.stage,
           count(DISTINCT b.id) FILTER (
             WHERE s.stage = 'approval'
                OR _round = 'all'
                OR b.v_active = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
           )::int AS total
    FROM base b CROSS JOIN stages s
    GROUP BY 1,2
  ),
  cnt AS (
    SELECT b.gk, e.stage,
           count(DISTINCT e.item_id) FILTER (WHERE e.field = 'planned')::int AS plan_upto,
           count(DISTINCT e.item_id) FILTER (WHERE e.field = 'actual')::int  AS actual_upto
    FROM base b
    JOIN ev e ON e.item_id = b.id
    WHERE e.edate <= _as_of_date
    GROUP BY 1,2
  )
  SELECT t.gk, t.stage, t.total,
         COALESCE(c.actual_upto, 0) AS done_upto,
         COALESCE(c.plan_upto, 0)   AS plan_upto,
         COALESCE(c.actual_upto, 0) AS actual_upto
  FROM tot t
  LEFT JOIN cnt c ON c.gk = t.gk AND c.stage = t.stage;
$function$;