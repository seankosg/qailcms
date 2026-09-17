-- TOC 3단계: 조회·판정 정본 함수
CREATE OR REPLACE FUNCTION public.toc_eval_as_of(_as_of date DEFAULT NULL::date)
RETURNS TABLE(
  item_id uuid, as_of date, stages jsonb, band_states jsonb,
  ready_bands int, ready_denom int, readiness_pct numeric,
  delayed int, primary_delay jsonb, judgment text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
WITH params AS (SELECT coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS d),
base AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.band, c.sort_order, c.value_type,
         c.actual_authority, c.done_codes,
         p.plan_start, p.plan_finish, p.code_value, coalesce(p.na_flag,false) AS na_flag,
         CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END AS a_s,
         CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END AS a_f
  FROM public.toc_items i
  CROSS JOIN public.toc_stage_catalog c
  LEFT JOIN public.toc_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active
),
trn AS (
  SELECT l.item_id,
         count(*)::int AS n,
         count(*) FILTER (WHERE s.conducted_date IS NOT NULL
                            AND s.conducted_date <= (SELECT d FROM params))::int AS conducted,
         count(*) FILTER (WHERE s.eval_form_date IS NOT NULL
                            AND s.eval_form_date <= (SELECT d FROM params))::int AS evaled,
         max(s.conducted_date) FILTER (WHERE s.conducted_date <= (SELECT d FROM params)) AS last_conducted,
         max(s.eval_form_date) FILTER (WHERE s.eval_form_date <= (SELECT d FROM params)) AS last_eval
  FROM public.toc_item_training_links l
  JOIN public.toc_training_sessions s ON s.id = l.session_id AND s.is_active
  GROUP BY 1
),
st AS (
  SELECT b.*,
    CASE
      WHEN b.na_flag THEN 'na'
      WHEN b.stage_code = 'TRN_CONDUCTED' THEN
        CASE WHEN coalesce(t.n,0) = 0 THEN 'none'
             WHEN t.conducted = t.n THEN 'done'
             WHEN t.conducted > 0 THEN 'wip'
             ELSE 'none' END
      WHEN b.stage_code = 'TRN_EVAL_FORM' THEN
        CASE WHEN coalesce(t.n,0) = 0 THEN 'none'
             WHEN t.evaled = t.n THEN 'done'
             WHEN t.evaled > 0 THEN 'wip'
             ELSE 'none' END
      ELSE public.spl_stage_state(
             CASE WHEN b.value_type = 'code' THEN 'flag' ELSE b.value_type END,
             b.plan_start, b.plan_finish, b.a_s, b.a_f,
             public.toc_code_flag(b.value_type, b.code_value, b.done_codes),
             b.na_flag, (SELECT d FROM params))
    END AS state,
    CASE WHEN b.stage_code = 'TRN_CONDUCTED' THEN t.last_conducted
         WHEN b.stage_code = 'TRN_EVAL_FORM' THEN t.last_eval
         ELSE b.a_f END AS eff_actual,
    (b.value_type = 'code' AND NOT b.na_flag
      AND nullif(btrim(coalesce(b.code_value,'')),'') IS NOT NULL
      AND public.toc_code_flag(b.value_type, b.code_value, b.done_codes) IS NULL) AS code_pending
  FROM base b
  LEFT JOIN trn t ON t.item_id = b.item_id
),
bandagg AS (
  SELECT item_id, band, min(sort_order) AS bo,
         count(*)::int AS n_all,
         count(*) FILTER (WHERE state = 'na')::int      AS n_na,
         count(*) FILTER (WHERE state = 'done')::int    AS n_done,
         count(*) FILTER (WHERE state IN ('wip','delayed'))::int AS n_act,
         count(*) FILTER (WHERE state = 'planned')::int AS n_plan,
         count(*) FILTER (WHERE code_pending)::int      AS n_codep
  FROM st GROUP BY item_id, band
),
tac AS (
  SELECT item_id,
         CASE WHEN n_na = n_all THEN 'na'
              WHEN n_done > 0 AND (n_na + n_done) = n_all THEN 'complete'
              WHEN n_act > 0 OR n_codep > 0 OR n_done > 0 THEN 'active'
              WHEN n_plan > 0 THEN 'planned'
              ELSE 'empty' END AS tac_state
  FROM bandagg WHERE band = 'TAC'
),
bandst AS (
  SELECT b.item_id, b.band, b.bo,
    CASE
      WHEN b.n_na = b.n_all THEN 'na'
      WHEN b.n_done > 0 AND (b.n_na + b.n_done) = b.n_all THEN 'complete'
      WHEN b.band = 'TRAINING' AND b.n_done = 0 AND b.n_act = 0 AND b.n_codep = 0
           AND coalesce(t.tac_state,'empty') IS DISTINCT FROM 'complete' THEN 'blocked'
      WHEN b.n_act > 0 OR b.n_codep > 0 OR b.n_done > 0 THEN 'active'
      WHEN b.n_plan > 0 THEN 'planned'
      ELSE 'empty' END AS bstate
  FROM bandagg b LEFT JOIN tac t ON t.item_id = b.item_id
),
bmap AS (SELECT item_id, jsonb_object_agg(band, bstate) AS band_states FROM bandst GROUP BY item_id),
ready AS (
  SELECT item_id,
    count(*) FILTER (WHERE band <> 'TOC' AND bstate = 'complete')::int AS ready_bands,
    count(*) FILTER (WHERE band <> 'TOC' AND bstate <> 'na')::int      AS ready_denom
  FROM bandst GROUP BY item_id
),
agg AS (
  SELECT s.item_id,
    jsonb_object_agg(s.stage_code, jsonb_build_object(
      'ps', s.plan_start, 'pf', s.plan_finish, 'as', s.a_s, 'af', s.eff_actual,
      'cv', s.code_value, 'na', s.na_flag, 'st', s.state)) AS stages,
    count(*) FILTER (WHERE s.state = 'delayed')::int AS delayed
  FROM st s GROUP BY s.item_id
),
pd AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
      'days', GREATEST(0, ((SELECT d FROM params) - coalesce(s.plan_finish, s.plan_start))::int)) AS primary_delay
  FROM st s WHERE s.state = 'delayed'
  ORDER BY s.item_id,
    GREATEST(0, ((SELECT d FROM params) - coalesce(s.plan_finish, s.plan_start))::int) DESC, s.sort_order
)
SELECT i.id, (SELECT d FROM params),
  coalesce(g.stages,'{}'::jsonb), coalesce(bm.band_states,'{}'::jsonb),
  coalesce(r.ready_bands,0), coalesce(r.ready_denom,0),
  CASE WHEN coalesce(r.ready_denom,0) = 0 THEN NULL
       ELSE round(r.ready_bands::numeric * 100 / r.ready_denom, 1) END,
  coalesce(g.delayed,0), pd.primary_delay,
  CASE
    WHEN coalesce(i.is_excluded,false) THEN 'Excluded'
    WHEN coalesce(g.stages->'HANDED_OVER'->>'st','') = 'done' THEN 'Handed Over'
    WHEN coalesce(g.stages->'TOC_SUBMIT'->>'st','') = 'done'
         AND coalesce(g.stages->'TOC_RESPONSE'->>'st','') <> 'done' THEN 'TOC Under Review'
    WHEN coalesce(r.ready_denom,0) > 0 AND r.ready_bands = r.ready_denom THEN 'TOC Ready'
    WHEN coalesce(g.delayed,0) > 0 THEN 'Delayed'
    WHEN coalesce(bm.band_states->>'TRAINING','') = 'blocked' THEN 'Blocked'
    WHEN EXISTS (SELECT 1 FROM bandst b WHERE b.item_id = i.id
                   AND b.bstate IN ('active','complete','planned')) THEN 'In Progress'
    ELSE 'Not Started'
  END
FROM public.toc_items i
LEFT JOIN agg g ON g.item_id = i.id
LEFT JOIN bmap bm ON bm.item_id = i.id
LEFT JOIN ready r ON r.item_id = i.id
LEFT JOIN pd ON pd.item_id = i.id
WHERE i.is_active
$fn$;

CREATE OR REPLACE FUNCTION public.toc_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_bands jsonb; v_viol jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'short_code', short_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'done_codes', done_codes, 'gate_band', gate_band, 'sort_order', sort_order)
         ORDER BY sort_order)
    INTO v_catalog FROM public.toc_stage_catalog;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'item_key', i.item_key, 'plot', i.plot,
    'team', i.team, 'team_raw', i.team_raw,
    'main_system', i.main_system, 'item_no', i.item_no, 'sub_system', i.sub_system,
    'location', i.location, 'supplier', i.supplier, 'pic', i.pic, 'eng', i.eng,
    'tac_qty_total', i.tac_qty_total, 'tac_qty_issued', i.tac_qty_issued,
    'abd_qty_total', i.abd_qty_total, 'abd_qty_code_a', i.abd_qty_code_a,
    'service_report_required', i.service_report_required,
    'toc_ref', i.toc_ref, 'toc_status', i.toc_status,
    'expected_ho_date', i.expected_ho_date, 'ho_status_raw', i.ho_status_raw,
    'is_excluded', i.is_excluded, 'exclusion_reason', i.exclusion_reason,
    'data_date', i.data_date,
    'stages', e.stages, 'band_states', e.band_states,
    'ready_bands', e.ready_bands, 'ready_denom', e.ready_denom,
    'readiness_pct', e.readiness_pct,
    'delayed', e.delayed, 'primary_delay', e.primary_delay,
    'judgment', e.judgment,
    'training_sessions', coalesce(tl.n, 0)
  ) ORDER BY i.main_system NULLS LAST, i.item_key)
  INTO v_rows
  FROM public.toc_items i
  JOIN public.toc_eval_as_of(v_as_of) e ON e.item_id = i.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n FROM public.toc_item_training_links l WHERE l.item_id = i.id
  ) tl ON true
  WHERE i.is_active;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  SELECT jsonb_object_agg(j, n) INTO v_counts FROM (
    SELECT r->>'judgment' AS j, count(*) AS n FROM jsonb_array_elements(v_rows) r GROUP BY 1) q;

  SELECT jsonb_object_agg(band, cnt) INTO v_bands FROM (
    SELECT b.key AS band, jsonb_object_agg(b.state, b.n) AS cnt FROM (
      SELECT kv.key, kv.value #>> '{}' AS state, count(*) AS n
      FROM jsonb_array_elements(v_rows) r, jsonb_each(r->'band_states') kv
      GROUP BY 1,2) b GROUP BY 1) q2;

  SELECT jsonb_object_agg(violation_type, n) INTO v_viol FROM (
    SELECT violation_type, count(*) AS n FROM public.toc_precedence_violations GROUP BY 1) q3;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'band_state_counts', coalesce(v_bands, '{}'::jsonb),
    'violations', coalesce(v_viol, '{}'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.toc_eval_as_of(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toc_rows_as_of(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toc_eval_as_of(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toc_rows_as_of(date) TO authenticated, service_role;