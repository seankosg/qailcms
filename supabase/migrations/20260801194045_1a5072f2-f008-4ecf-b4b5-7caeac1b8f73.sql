CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_reqdoc jsonb;
  v_viol_total int; v_viol_new int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'chain_excluded', chain_excluded,
           'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.spl_stage_catalog;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'spl_number', i.spl_number, 'plot', i.plot, 'dis', i.dis,
    'service', i.service, 'title', i.title, 'team', i.team,
    'pic', i.pic, 'eng', i.eng, 'pic_po', i.pic_po, 'eng_po', i.eng_po,
    'supplier', i.supplier, 'latest_status', i.latest_status,
    'approval_status_raw', i.approval_status_raw, 'revision', i.revision,
    'data_date', i.data_date,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'stages', e.stages,
    'na_count', e.na_count, 'done', e.done, 'delayed', e.delayed, 'denom', e.denom,
    'req_doc_done', e.req_doc_done, 'req_doc_total', e.req_doc_total,
    'active_band', e.active_band,
    'completed_stage', e.completed_stage, 'current_stage', e.current_stage,
    'primary_delay', e.primary_delay, 'delay_bucket', e.delay_bucket,
    'progress_pct', CASE WHEN e.denom = 0 THEN NULL
                         ELSE round(e.done::numeric * 100 / e.denom, 1) END,
    'judgment', e.judgment
  ) ORDER BY i.plot, i.spl_number)
  INTO v_rows
  FROM public.spl_items i
  JOIN public.spl_eval_as_of(v_as_of) e ON e.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;

  SELECT jsonb_object_agg(k, n) INTO v_reqdoc FROM (
    SELECT (r->>'req_doc_done') AS k, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;

  SELECT count(*) INTO v_viol_total FROM public.spl_precedence_violations;
  SELECT id INTO v_last_batch FROM public.spl_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_viol_new FROM public.spl_precedence_violations v
   WHERE v_last_batch IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.spl_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'req_doc_counts', coalesce(v_reqdoc, '{}'::jsonb),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_total,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch));
END;
$function$;

CREATE OR REPLACE FUNCTION public.wrt_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb;
  v_viol_total int; v_viol_new int; v_viol_prec int; v_viol_ghost int;
  v_viol_resp int; v_pending int; v_pending_r1 int; v_pending_r2 int;
  v_pending_items int; v_inspected int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'chain_excluded', chain_excluded,
           'round_no', round_no, 'sort_order', sort_order) ORDER BY sort_order)
    INTO v_catalog FROM public.wrt_stage_catalog;

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
    'stages', e.stages,
    'na_count', e.na_count, 'done', e.done, 'delayed', e.delayed, 'denom', e.denom,
    'active_band', e.active_band,
    'completed_stage', e.completed_stage, 'current_stage', e.current_stage,
    'primary_delay', e.primary_delay, 'delay_bucket', e.delay_bucket,
    'response_wait', e.response_wait,
    'progress_pct', CASE WHEN e.denom = 0 THEN NULL
                         ELSE round(e.done::numeric * 100 / e.denom, 1) END,
    'judgment', e.judgment
  ) ORDER BY i.plot, i.wrt_number)
  INTO v_rows
  FROM public.wrt_items i
  JOIN public.wrt_eval_as_of(v_as_of) e ON e.item_id = i.id
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;

  SELECT count(*) FILTER (WHERE violation_type <> 'pending_hdec'),
         count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'ghost_round'),
         count(*) FILTER (WHERE violation_type = 'response_before_submission'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_1'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_2')
    INTO v_viol_total, v_viol_prec, v_viol_ghost, v_viol_resp, v_pending, v_pending_r1, v_pending_r2
    FROM public.wrt_precedence_violations;

  SELECT count(DISTINCT item_id) INTO v_pending_items
    FROM public.wrt_precedence_violations WHERE violation_type = 'pending_hdec';

  SELECT count(*) INTO v_inspected FROM public.wrt_items i
   WHERE i.is_active
     AND EXISTS (SELECT 1 FROM public.wrt_stage_progress p
                  WHERE p.item_id = i.id
                    AND p.stage_code IN ('SUBMISSION_R1','SUBMISSION_R2')
                    AND coalesce(p.actual_finish, p.actual_start) IS NOT NULL);

  SELECT id INTO v_last_batch FROM public.wrt_import_logs
   WHERE status = 'success' ORDER BY created_at DESC LIMIT 1;

  SELECT count(*) INTO v_viol_new FROM public.wrt_precedence_violations v
   WHERE v_last_batch IS NOT NULL AND v.violation_type <> 'pending_hdec'
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
      'pending_hdec_items', coalesce(v_pending_items,0),
      'inspected_items', coalesce(v_inspected,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch));
END;
$function$;

DROP FUNCTION IF EXISTS public.spl_judge_v1(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.wrt_judge_v1(boolean, text, boolean, integer, integer, integer);