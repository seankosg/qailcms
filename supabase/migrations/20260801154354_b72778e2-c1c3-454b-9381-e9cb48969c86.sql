CREATE OR REPLACE FUNCTION public.snag_progress_cell_ids(_stage text, _field text, _from date, _to date, _as_of date DEFAULT NULL::date, _plan_mode text DEFAULT 'baseline'::text)
 RETURNS TABLE(item_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- _stage: 'all' | 단일 스테이지 | 콤마 구분 목록(집계 셀)
  -- _to 가 NULL 이면 단일 일자 셀로 간주(coalesce 방어, ABD 구현과 동일).
  SELECT DISTINCT e.item_id
  FROM public.snag_progress_events(coalesce(_as_of, current_date), _plan_mode) e
  WHERE (_stage = 'all' OR e.stage = ANY(string_to_array(_stage, ',')))
    AND e.field = _field
    AND e.edate BETWEEN _from AND coalesce(_to, _from)
$function$;