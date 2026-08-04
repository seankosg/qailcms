-- 1) 파생/허용 컬럼 목록에 OCS 캐시 명시
CREATE OR REPLACE FUNCTION public.abd_derived_cols()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- 파생 컬럼 화이트리스트. 추가 시 이 배열을 갱신할 것.
  SELECT ARRAY[
    'current_stage','ur_aging_days','bucket_top','latest_status_norm','delay_bucket',
    'delay_late','primary_delay','completed_stage','completed_stage_group',
    'ocs_check','ocs_total','ocs_complied'
  ]::text[];
$function$;

-- 2) as-of 과거 조회 시 OCS 캐시는 NULL (스냅샷 없음 → 표시 안 함)
CREATE OR REPLACE FUNCTION public.abd_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS SETOF abd_items_raw
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_now date := (now() AT TIME ZONE 'Asia/Qatar')::date;
BEGIN
  IF _as_of IS NULL OR _as_of >= v_now THEN
    RETURN QUERY SELECT * FROM public.abd_items_raw;
  ELSE
    RETURN QUERY
      SELECT p.*
      FROM public.abd_items_raw r
      CROSS JOIN LATERAL jsonb_populate_record(
        r.*,
        public.abd_judge_v1(r.*, _as_of)
          || public.abd_mask_future_actuals(r.*, _as_of)
          || jsonb_build_object('ocs_total', NULL, 'ocs_complied', NULL, 'ocs_check', NULL)
      ) p;
  END IF;
END;
$function$;

-- 3) abd_items_search: ocs_check 정렬 표준 순서 (pending > ok > none)
DO $do$
DECLARE
  v_def text;
  v_old text := '    _sort_sql := _sort_sql || format(''%I %s NULLS LAST'', _col, CASE WHEN coalesce((_sort_item->>''desc'')::boolean, false) THEN ''DESC'' ELSE ''ASC'' END);';
  v_new text :=
    '    IF _col = ''ocs_check'' THEN'                                                                         || chr(10) ||
    '      _sort_sql := _sort_sql || format(''(case ocs_check when ''''pending'''' then 0 when ''''ok'''' then 1 else 2 end) %s NULLS LAST'', CASE WHEN coalesce((_sort_item->>''desc'')::boolean, false) THEN ''DESC'' ELSE ''ASC'' END);' || chr(10) ||
    '    ELSE'                                                                                                 || chr(10) ||
    '      _sort_sql := _sort_sql || format(''%I %s NULLS LAST'', _col, CASE WHEN coalesce((_sort_item->>''desc'')::boolean, false) THEN ''DESC'' ELSE ''ASC'' END);' || chr(10) ||
    '    END IF;';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'abd_items_search';
  IF v_def IS NULL THEN RAISE EXCEPTION 'abd_items_search not found'; END IF;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'abd_items_search: sort line pattern not found — manual review required';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END $do$;