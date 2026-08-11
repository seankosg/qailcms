CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_today boolean := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date)
                     >= (now() AT TIME ZONE 'Asia/Qatar')::date;
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_reqdoc jsonb; v_bands jsonb;
  v_viol_prec int; v_viol_imp int; v_viol_new int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'short_code', short_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'chain_excluded', chain_excluded, 'round_no', round_no, 'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.spl_stage_catalog;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'spl_number', i.spl_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng, 'pic_po', i.pic_po, 'eng_po', i.eng_po,
    'supplier', i.supplier, 'latest_status', i.latest_status,
    'approval_status_raw', i.approval_status_raw, 'revision', i.revision,
    'data_date', i.data_date,
    'active_round', ar.active_round,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'stages', e.stages,
    'na_count', e.na_count, 'done', e.done, 'delayed', e.delayed, 'denom', e.denom,
    'req_doc_done', e.req_doc_done, 'req_doc_total', e.req_doc_total,
    'active_band', e.active_band, 'active_band_state', e.active_band_state,
    'band_states', e.band_states,
    'hdec_actual_count', e.hdec_actual_count, 'has_plan', e.has_plan,
    'completed_stage', e.completed_stage, 'current_stage', e.current_stage,
    'primary_delay', e.primary_delay, 'delay_bucket', e.delay_bucket,
    -- 2026-08-11: Progress = Actual / Plan
    --   분모(plan_cnt) = 판정 대상(chain_excluded 아님) + N/A 아님 + 계획일 보유 단계
    --   분자(act_cnt)  = 그 중 기준일(as_of) 이전 실적일이 입력된 단계
    'progress_plan', coalesce(pa.plan_cnt, 0),
    'progress_actual', coalesce(pa.act_cnt, 0),
    'progress_pct', CASE WHEN coalesce(pa.plan_cnt,0) = 0 THEN NULL
                         ELSE round(pa.act_cnt::numeric * 100 / pa.plan_cnt, 1) END,
    'judgment', e.judgment,
    -- 관계 정본에서 파생된 캐시. 과거 as-of 조회에서는 공란(null)
    'ocs_total', CASE WHEN v_today THEN i.ocs_total END,
    'ocs_pending', CASE WHEN v_today THEN i.ocs_pending END,
    'ocs_complied', CASE WHEN v_today THEN i.ocs_complied END,
    'ocs_check', CASE WHEN v_today THEN i.ocs_check END,
    'rsp_total', CASE WHEN v_today THEN i.rsp_total END,
    'document_total', CASE WHEN v_today THEN i.document_total END
  ) ORDER BY i.plot, i.spl_number)
  INTO v_rows
  FROM public.spl_items i
  JOIN public.spl_eval_as_of(v_as_of) e ON e.item_id = i.id
  JOIN public.spl_active_round(v_as_of) ar ON ar.item_id = i.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS plan_cnt,
           count(*) FILTER (
             WHERE coalesce(p.actual_finish, p.actual_start) IS NOT NULL
               AND coalesce(p.actual_finish, p.actual_start) <= v_as_of)::int AS act_cnt
    FROM public.spl_stage_catalog c
    JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
    WHERE NOT c.chain_excluded
      AND NOT coalesce(p.na_flag, false)
      AND coalesce(p.plan_start, p.plan_finish) IS NOT NULL
  ) pa ON true
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;
  SELECT jsonb_object_agg(k, n) INTO v_reqdoc FROM (
    SELECT (r->>'req_doc_done') AS k, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;
  SELECT jsonb_object_agg(band, cnt) INTO v_bands FROM (
    SELECT b.key AS band, jsonb_object_agg(b.state, b.n) AS cnt FROM (
      SELECT kv.key, kv.value #>> '{}' AS state, count(*) AS n
      FROM jsonb_array_elements(v_rows) r,
           jsonb_each(r->'band_states') kv
      GROUP BY 1,2) b GROUP BY 1) q2;

  SELECT count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'import_incomplete')
    INTO v_viol_prec, v_viol_imp FROM public.spl_precedence_violations;

  SELECT id INTO v_last_batch FROM public.spl_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_viol_new FROM public.spl_precedence_violations v
   WHERE v_last_batch IS NOT NULL AND v.violation_type = 'precedence'
     AND EXISTS (SELECT 1 FROM public.spl_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'req_doc_counts', coalesce(v_reqdoc, '{}'::jsonb),
    'band_state_counts', coalesce(v_bands, '{}'::jsonb),
    'hdec_missing_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0),
    'hdec_missing_done', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0 AND r->>'judgment' = '완료'),
    'plan_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'has_plan')::boolean),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_prec,0),
      'precedence', coalesce(v_viol_prec,0),
      'import_incomplete', coalesce(v_viol_imp,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch));
END;
$function$;