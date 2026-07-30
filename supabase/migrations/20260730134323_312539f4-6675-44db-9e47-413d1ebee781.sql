CREATE OR REPLACE FUNCTION public._snag_progress_norm(_v numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN _v IS NULL THEN 0
    WHEN _v > 1 THEN _v
    ELSE _v * 100
  END
$function$;

CREATE OR REPLACE FUNCTION public._snag_done_asof(_stage text, _sr text, _asd date, _acd date, _axd date, _pnorm numeric, _as_of date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  -- A안(2026-07-30 확정): done 은 해당 스테이지 '자기 실적일' 만 인정한다.
  -- 캐스케이드(후행 스테이지 날짜) 및 상태 스칼라(status_raw, progress_pct) 인정은 제거.
  -- 2026-07-30 성능: SET search_path 제거 + 스키마 객체 미참조 → SQL 인라인 가능.
  SELECT CASE _stage
    WHEN 'start'     THEN (_asd IS NOT NULL AND _asd <= _as_of)
    WHEN 'rectified' THEN (_acd IS NOT NULL AND _acd <= _as_of)
    WHEN 'closure'   THEN (_axd IS NOT NULL AND _axd <= _as_of)
    ELSE false
  END
$function$;

ANALYZE public.defect_items_raw;