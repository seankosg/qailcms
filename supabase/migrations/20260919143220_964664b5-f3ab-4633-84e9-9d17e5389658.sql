CREATE OR REPLACE FUNCTION public.snag_progress_cell_ids(_stage text, _field text, _from date, _to date, _as_of date DEFAULT NULL::date, _plan_mode text DEFAULT 'baseline'::text)
RETURNS TABLE(item_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- _stage: 'all' | 단일 스테이지 | 콤마 구분 목록(집계 셀)
  -- _to 가 NULL 이면 단일 일자 셀로 간주(coalesce 방어, ABD 구현과 동일).
  -- 2026-09-19 추가: _plan_mode='remaining' + _field='planned' + _from <= '0001-01-01'
  --   → "잔여 전체" 계약. 계획일 유무와 무관하게 해당 스테이지가 as-of 기준 미완료인 항목 전부.
  --     판정은 정본 public._snag_done_asof 를 그대로 사용한다(사본 금지).
  SELECT r.id
  FROM public.defect_items_raw r
  CROSS JOIN LATERAL (VALUES
    ('start'::text), ('rectified'), ('pre_inspection'), ('dar_inspection'), ('closure'), ('ho')
  ) AS v(stage)
  WHERE _plan_mode = 'remaining' AND _field = 'planned' AND _from <= '0001-01-01'::date
    AND r.is_active = true
    AND (_stage = 'all' OR v.stage = ANY(string_to_array(_stage, ',')))
    AND NOT public._snag_done_asof(
      v.stage, NULL, r.actual_start_date, r.actual_rectified_date, r.actual_closure_date, NULL,
      coalesce(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date),
      r.actual_pre_inspection_date, r.actual_dar_inspection_date, r.actual_ho_date)
  GROUP BY r.id

  UNION

  SELECT DISTINCT e.item_id
  FROM public.snag_progress_events(coalesce(_as_of, (current_timestamp AT TIME ZONE 'Asia/Qatar')::date), _plan_mode) e
  WHERE NOT (_plan_mode = 'remaining' AND _field = 'planned' AND _from <= '0001-01-01'::date)
    AND (_stage = 'all' OR e.stage = ANY(string_to_array(_stage, ',')))
    AND e.field = _field
    AND e.edate BETWEEN _from AND coalesce(_to, _from)
$function$;