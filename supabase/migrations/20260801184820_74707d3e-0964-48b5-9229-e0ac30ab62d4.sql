CREATE OR REPLACE FUNCTION public.wrt_rows_as_of(_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb;
  v_viol_total int; v_viol_new int; v_viol_prec int; v_viol_ghost int;
  v_viol_resp int; v_pending int; v_pending_r1 int; v_pending_r2 int;
  v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'round_no', round_no, 'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.wrt_stage_catalog;

  WITH st AS (
    SELECT i.id AS item_id, c.stage_code, c.value_type, c.sort_order,
      p.na_flag, p.plan_start, p.plan_finish,
      CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END AS actual_start,
      CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END AS actual_finish,
      p.flag_value,
      public.wrt_stage_state(c.value_type, p.plan_start, p.plan_finish,
        CASE WHEN p.actual_start  <= v_as_of THEN p.actual_start  END,
        CASE WHEN p.actual_finish <= v_as_of THEN p.actual_finish END,
        p.flag_value, p.na_flag, v_as_of) AS state
    FROM public.wrt_items i
    CROSS JOIN public.wrt_stage_catalog c
    LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
    WHERE i.is_active
  ), agg AS (
    SELECT item_id,
      jsonb_object_agg(stage_code, jsonb_build_object(
        'ps', plan_start, 'pf', plan_finish, 'as', actual_start, 'af', actual_finish,
        'fv', flag_value, 'na', coalesce(na_flag,false), 'st', state)) AS stages,
      count(*) FILTER (WHERE state <> 'na' AND state <> 'none') AS denom,
      count(*) FILTER (WHERE state = 'done')                    AS done,
      count(*) FILTER (WHERE state = 'delayed')                 AS delayed,
      count(*) FILTER (WHERE state = 'na')                      AS na_cnt
    FROM st GROUP BY item_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'wrt_number', i.wrt_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng,
    'r1_response_code', i.r1_response_code, 'r2_response_code', i.r2_response_code,
    'latest_response_code', i.latest_response_code,
    'is_final_approved', i.is_final_approved,
    'response_source', i.response_source,
    'active_round', i.active_round,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'latest_status_raw', i.latest_status_raw,
    'data_date', i.data_date,
    'stages', coalesce(a.stages, '{}'::jsonb),
    'na_count', coalesce(a.na_cnt,0),
    'done', coalesce(a.done,0), 'delayed', coalesce(a.delayed,0),
    'denom', coalesce(a.denom,0),
    'progress_pct', CASE WHEN coalesce(a.denom,0) = 0 THEN NULL
                         ELSE round(a.done::numeric * 100 / a.denom, 1) END,
    'judgment', public.wrt_judge_v1(i.is_final_approved, i.latest_response_code, i.is_excluded,
                                    coalesce(a.done,0)::int, coalesce(a.delayed,0)::int, coalesce(a.denom,0)::int)
  ) ORDER BY i.plot, i.wrt_number)
  INTO v_rows
  FROM public.wrt_items i
  LEFT JOIN agg a ON a.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n
    FROM jsonb_array_elements(v_rows) r GROUP BY 1
  ) q;

  -- 분리 기준:
  --   pending_hdec = 해당 아이템의 HDEC 제출 실적이 전 라운드에 걸쳐 전무한데 Aconex 회신만 존재 → 위반 아님(임포트 대기)
  --   violation    = precedence / ghost_round(라운드 귀속 불일치) / response_before_submission
  SELECT count(*) FILTER (WHERE violation_type <> 'pending_hdec'),
         count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'ghost_round'),
         count(*) FILTER (WHERE violation_type = 'response_before_submission'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_1'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_2')
    INTO v_viol_total, v_viol_prec, v_viol_ghost, v_viol_resp, v_pending, v_pending_r1, v_pending_r2
    FROM public.wrt_precedence_violations;

  SELECT id INTO v_last_batch FROM public.wrt_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_viol_new
    FROM public.wrt_precedence_violations v
   WHERE v_last_batch IS NOT NULL
     AND v.violation_type <> 'pending_hdec'
     AND EXISTS (SELECT 1 FROM public.wrt_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_total,0),
      'precedence', coalesce(v_viol_prec,0),
      'ghost_round', coalesce(v_viol_ghost,0),
      'response_before_submission', coalesce(v_viol_resp,0),
      'pending_hdec', coalesce(v_pending,0),
      'pending_hdec_r1', coalesce(v_pending_r1,0),
      'pending_hdec_r2', coalesce(v_pending_r2,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch)
  );
END;
$function$;