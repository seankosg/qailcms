-- SPL 정본 판정 함수 ------------------------------------------------------
-- 화면·집계·드릴다운은 반드시 이 함수들을 경유한다. 원시 테이블 직조회 + 클라 재계산 금지.

CREATE OR REPLACE FUNCTION public.spl_stage_state(
  _value_type text,
  _plan_start date, _plan_finish date,
  _actual_start date, _actual_finish date,
  _flag text, _na boolean, _as_of date
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(_na, false) THEN 'na'
    WHEN _value_type = 'flag' THEN
      CASE WHEN nullif(btrim(coalesce(_flag,'')),'') IS NOT NULL THEN 'done' ELSE 'none' END
    -- 기준일(as_of) 이후 실적은 아직 없었던 것으로 마스킹
    WHEN _value_type = 'range' AND _actual_finish IS NOT NULL AND _actual_finish <= _as_of THEN 'done'
    WHEN _value_type <> 'range'
     AND coalesce(_actual_finish, _actual_start) IS NOT NULL
     AND coalesce(_actual_finish, _actual_start) <= _as_of THEN 'done'
    WHEN _actual_start IS NOT NULL AND _actual_start <= _as_of THEN
      CASE WHEN coalesce(_plan_finish, _plan_start) IS NOT NULL
             AND coalesce(_plan_finish, _plan_start) < _as_of THEN 'delayed' ELSE 'wip' END
    WHEN coalesce(_plan_finish, _plan_start) IS NOT NULL
     AND coalesce(_plan_finish, _plan_start) < _as_of THEN 'delayed'
    WHEN coalesce(_plan_start, _plan_finish) IS NOT NULL THEN 'planned'
    ELSE 'none'
  END
$$;

-- 행 판정 정본: 완료 / 지연 / 정상 / 미분류(분모 0)
CREATE OR REPLACE FUNCTION public.spl_judge_v1(_done int, _delayed int, _denom int)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_done,0) >= _denom THEN '완료'
    WHEN coalesce(_delayed,0) > 0 THEN '지연'
    ELSE '정상'
  END
$$;

GRANT EXECUTE ON FUNCTION public.spl_stage_state(text,date,date,date,date,text,boolean,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spl_judge_v1(int,int,int) TO authenticated;

-- As-of 정본 조회 -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.spl_rows_as_of(date);

CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb;
  v_rows jsonb;
  v_counts jsonb;
  v_viol_total int;
  v_viol_new int;
  v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.spl_stage_catalog;

  WITH st AS (
    SELECT
      i.id AS item_id,
      c.stage_code, c.value_type, c.sort_order, c.actual_authority,
      p.na_flag,
      -- 기준일 이후 실적은 마스킹 (as-of 정책)
      p.plan_start, p.plan_finish,
      CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END AS actual_start,
      CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END AS actual_finish,
      p.flag_value,
      public.spl_stage_state(c.value_type, p.plan_start, p.plan_finish,
        CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END,
        CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END,
        p.flag_value, p.na_flag, v_as_of) AS state
    FROM public.spl_items i
    CROSS JOIN public.spl_stage_catalog c
    LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
    WHERE i.is_active
  ), agg AS (
    SELECT item_id,
      jsonb_object_agg(stage_code, jsonb_build_object(
        'ps', plan_start, 'pf', plan_finish,
        'as', actual_start, 'af', actual_finish,
        'fv', flag_value, 'na', coalesce(na_flag,false), 'st', state)) AS stages,
      count(*) FILTER (WHERE state <> 'na' AND state <> 'none')            AS denom,
      count(*) FILTER (WHERE state = 'done')                               AS done,
      count(*) FILTER (WHERE state = 'delayed')                            AS delayed,
      count(*) FILTER (WHERE state = 'na')                                 AS na_cnt
    FROM st GROUP BY item_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'spl_number', i.spl_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng, 'pic_po', i.pic_po, 'eng_po', i.eng_po,
    'supplier', i.supplier, 'latest_status', i.latest_status,
    'approval_status_raw', i.approval_status_raw, 'revision', i.revision,
    'data_date', i.data_date,
    'stages', coalesce(a.stages, '{}'::jsonb),
    'na_count', coalesce(a.na_cnt,0),
    'done', coalesce(a.done,0), 'delayed', coalesce(a.delayed,0),
    'denom', coalesce(a.denom,0),
    'progress_pct', CASE WHEN coalesce(a.denom,0) = 0 THEN NULL
                         ELSE round(a.done::numeric * 100 / a.denom, 1) END,
    'judgment', public.spl_judge_v1(coalesce(a.done,0)::int, coalesce(a.delayed,0)::int, coalesce(a.denom,0)::int)
  ) ORDER BY i.plot, i.spl_number)
  INTO v_rows
  FROM public.spl_items i
  LEFT JOIN agg a ON a.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n
    FROM jsonb_array_elements(v_rows) r GROUP BY 1
  ) q;

  SELECT count(*) INTO v_viol_total FROM public.spl_precedence_violations;

  SELECT id INTO v_last_batch FROM public.spl_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_viol_new
    FROM public.spl_precedence_violations v
   WHERE v_last_batch IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.spl_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_total,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.spl_rows_as_of(date) TO authenticated;