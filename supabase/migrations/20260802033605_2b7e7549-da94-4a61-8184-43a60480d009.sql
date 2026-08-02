-- ============ 1. 무결성 뷰 재작성 (전체 격자 기준) ============
DROP VIEW IF EXISTS public.spl_precedence_violations;
CREATE VIEW public.spl_precedence_violations AS
WITH grid AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.sort_order,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any,
         (p.item_id IS NOT NULL) AS has_row
  FROM public.spl_items i
  CROSS JOIN public.spl_stage_catalog c
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active AND c.actual_authority = 'HDEC'
    AND c.value_type <> 'flag' AND NOT c.chain_excluded
)
SELECT
  CASE WHEN m.rows_present = 0 THEN 'import_incomplete' ELSE 'precedence' END AS violation_type,
  g.item_id, i.spl_number, i.plot, i.team,
  g.stage_code, g.label, g.sort_order, g.actual_any AS actual_date,
  m.missing_predecessors,
  CASE WHEN m.rows_present = 0
       THEN '선행 단계 자료 미유입 (progress 행 자체 부재)'
       ELSE '선행 단계 실적 없이 후행 실적 존재' END AS detail
FROM grid g
JOIN public.spl_items i ON i.id = g.item_id
CROSS JOIN LATERAL (
  SELECT count(*)::int AS missing_predecessors,
         count(*) FILTER (WHERE pr.has_row)::int AS rows_present
  FROM grid pr
  WHERE pr.item_id = g.item_id AND pr.sort_order < g.sort_order AND pr.actual_any IS NULL
) m
WHERE g.actual_any IS NOT NULL AND m.missing_predecessors > 0;

DROP VIEW IF EXISTS public.wrt_precedence_violations;
CREATE VIEW public.wrt_precedence_violations AS
WITH grid AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.sort_order,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any,
         (p.item_id IS NOT NULL) AS has_row
  FROM public.wrt_items i
  CROSS JOIN public.wrt_stage_catalog c
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active AND c.actual_authority = 'HDEC'
    AND c.value_type <> 'flag' AND NOT c.chain_excluded
    AND (c.round_no IS NULL OR c.round_no <= COALESCE(i.active_round, 1))
),
prec AS (
  SELECT
    CASE WHEN m.rows_present = 0 THEN 'import_incomplete' ELSE 'precedence' END AS violation_type,
    g.item_id, i.wrt_number, i.plot, i.team,
    g.stage_code, g.label, g.sort_order, g.actual_any AS actual_date,
    m.missing_predecessors,
    CASE WHEN m.rows_present = 0
         THEN '선행 단계 자료 미유입 (progress 행 자체 부재)'
         ELSE '선행 단계 실적 없이 후행 실적 존재' END AS detail
  FROM grid g
  JOIN public.wrt_items i ON i.id = g.item_id
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS missing_predecessors,
           count(*) FILTER (WHERE pr.has_row)::int AS rows_present
    FROM grid pr
    WHERE pr.item_id = g.item_id AND pr.sort_order < g.sort_order AND pr.actual_any IS NULL
  ) m
  WHERE g.actual_any IS NOT NULL AND m.missing_predecessors > 0
),
sub_any AS (
  SELECT i.id AS item_id,
         EXISTS (SELECT 1 FROM public.wrt_stage_progress p
                  WHERE p.item_id = i.id
                    AND p.stage_code IN ('SUBMISSION_R1','SUBMISSION_R2')
                    AND COALESCE(p.actual_finish, p.actual_start) IS NOT NULL) AS has_sub
  FROM public.wrt_items i
),
rounds AS (
  SELECT i.id AS item_id, i.wrt_number, i.plot, i.team, r.n, sa.has_sub,
         sub.actual_any AS sub_actual, rd.actual_any AS resp_actual,
         NULLIF(btrim(CASE WHEN r.n = 1 THEN i.r1_response_code ELSE i.r2_response_code END), '') AS resp_code
  FROM public.wrt_items i
  JOIN sub_any sa ON sa.item_id = i.id
  CROSS JOIN (VALUES (1),(2)) r(n)
  LEFT JOIN LATERAL (SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
                       FROM public.wrt_stage_progress p
                      WHERE p.item_id = i.id AND p.stage_code = ('SUBMISSION_R' || r.n)) sub ON true
  LEFT JOIN LATERAL (SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
                       FROM public.wrt_stage_progress p
                      WHERE p.item_id = i.id AND p.stage_code = ('RESPONSE_DATE_R' || r.n)) rd ON true
  WHERE i.is_active
),
rnd AS (
  SELECT vtype AS violation_type, item_id, wrt_number, plot, team,
         ('ROUND_' || n)::text AS stage_code,
         ('Round ' || n)::text AS label,
         (n * 1000)::int AS sort_order,
         resp_actual AS actual_date,
         0::int AS missing_predecessors,
         CASE vtype
           WHEN 'pending_hdec' THEN 'HDEC 제출 실적 전무 상태에서 Aconex 회신만 존재 (위반 아님)'
           WHEN 'ghost_round' THEN '해당 라운드 제출 실적 없이 회신 존재'
           ELSE '회신일이 제출 실적일보다 선행' END AS detail
  FROM (
    SELECT r.*,
      CASE
        WHEN r.sub_actual IS NULL AND NOT r.has_sub THEN 'pending_hdec'
        WHEN r.sub_actual IS NULL AND r.has_sub THEN 'ghost_round'
        WHEN r.resp_actual IS NOT NULL AND r.resp_actual < r.sub_actual THEN 'response_before_submission'
        ELSE NULL END AS vtype
    FROM rounds r
    WHERE r.resp_actual IS NOT NULL OR r.resp_code IS NOT NULL
  ) c WHERE vtype IS NOT NULL
)
SELECT * FROM prec
UNION ALL
SELECT * FROM rnd;

-- ============ 2. 판정 함수 v3 (미착수 신설) ============
CREATE OR REPLACE FUNCTION public.spl_judge_v3(
  _is_excluded boolean, _latest_status text, _denom integer,
  _has_primary_delay boolean, _band_state text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_is_excluded,false) THEN '제외'
    WHEN upper(btrim(coalesce(_latest_status,''))) = 'A' THEN '완료'
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_has_primary_delay,false) THEN '지연'
    WHEN _band_state = 'empty' THEN '미착수'
    ELSE '정상'
  END
$$;

CREATE OR REPLACE FUNCTION public.wrt_judge_v3(
  _is_excluded boolean, _is_final_approved boolean, _denom integer,
  _has_primary_delay boolean, _band_state text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_is_excluded,false) THEN '제외'
    WHEN coalesce(_is_final_approved,false) THEN '완료'
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_has_primary_delay,false) THEN '지연'
    WHEN _band_state = 'empty' THEN '미착수'
    ELSE '정상'
  END
$$;

-- ============ 3. eval 재작성 (밴드 3값 상태 + HDEC 실적/계획 보유) ============
DROP FUNCTION IF EXISTS public.spl_eval_as_of(date);
CREATE FUNCTION public.spl_eval_as_of(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, as_of date, stages jsonb, denom integer, done integer,
  delayed integer, na_count integer, req_doc_done integer, req_doc_total integer,
  active_band text, active_band_state text, hdec_actual_count integer, has_plan boolean,
  completed_stage jsonb, current_stage jsonb, primary_delay jsonb, delay_bucket jsonb,
  band_states jsonb, judgment text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
WITH params AS (SELECT coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS d),
st AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.band, c.sort_order, c.value_type,
         c.actual_authority, c.chain_excluded,
         p.plan_start, p.plan_finish, p.flag_value, p.na_flag,
         CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END AS a_s,
         CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END AS a_f,
         public.spl_stage_state(c.value_type, p.plan_start, p.plan_finish,
           CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END,
           CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END,
           p.flag_value, p.na_flag, (SELECT d FROM params)) AS state
  FROM public.spl_items i
  CROSS JOIN public.spl_stage_catalog c
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active
),
bandst AS (
  SELECT item_id, band, min(sort_order) AS bo,
         count(*) FILTER (WHERE state NOT IN ('na','none')) AS bdenom,
         count(*) FILTER (WHERE state NOT IN ('na','none','done')) AS bopen
  FROM st WHERE NOT chain_excluded GROUP BY item_id, band
),
bandst2 AS (
  SELECT *, CASE WHEN bdenom = 0 THEN 'empty' WHEN bopen > 0 THEN 'active' ELSE 'complete' END AS bstate
  FROM bandst
),
bmap AS (
  SELECT item_id, jsonb_object_agg(band, bstate) AS band_states FROM bandst2 GROUP BY item_id
),
active AS (
  SELECT DISTINCT ON (item_id) item_id, band, bo, bstate
  FROM bandst2 WHERE bstate <> 'complete' ORDER BY item_id, bo
),
hdec AS (
  SELECT s.item_id,
    count(*) FILTER (WHERE s.actual_authority = 'HDEC' AND coalesce(s.a_f, s.a_s) IS NOT NULL)::int AS hdec_actual_count,
    bool_or(s.plan_start IS NOT NULL OR s.plan_finish IS NOT NULL) AS has_plan
  FROM st s GROUP BY s.item_id
),
agg AS (
  SELECT s.item_id,
    jsonb_object_agg(s.stage_code, jsonb_build_object(
      'ps', s.plan_start, 'pf', s.plan_finish, 'as', s.a_s, 'af', s.a_f,
      'fv', s.flag_value, 'na', coalesce(s.na_flag,false), 'st', s.state)) AS stages,
    count(*) FILTER (WHERE NOT s.chain_excluded AND s.state NOT IN ('na','none'))::int AS denom,
    count(*) FILTER (WHERE NOT s.chain_excluded AND s.state = 'done')::int    AS done,
    count(*) FILTER (WHERE NOT s.chain_excluded AND s.state = 'delayed')::int AS delayed,
    count(*) FILTER (WHERE NOT s.chain_excluded AND s.state = 'na')::int      AS na_count,
    count(*) FILTER (WHERE s.chain_excluded AND s.state = 'done')::int        AS req_doc_done,
    count(*) FILTER (WHERE s.chain_excluded)::int                             AS req_doc_total
  FROM st s GROUP BY s.item_id
),
pd AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
      'days', GREATEST(0, ((SELECT d FROM params) - coalesce(s.plan_finish, s.plan_start))::int)) AS primary_delay
  FROM st s JOIN active a ON a.item_id = s.item_id AND a.band = s.band
  WHERE s.state = 'delayed' AND NOT s.chain_excluded AND s.actual_authority = 'HDEC'
  ORDER BY s.item_id, s.sort_order
),
bucket AS (
  SELECT s.item_id, jsonb_agg(jsonb_build_object('stage_code', s.stage_code, 'label', s.label,
           'band', s.band, 'authority', s.actual_authority) ORDER BY s.sort_order) AS delay_bucket
  FROM st s LEFT JOIN pd ON pd.item_id = s.item_id
  WHERE s.state = 'delayed' AND NOT s.chain_excluded
    AND coalesce(pd.primary_delay->>'stage_code','') <> s.stage_code
  GROUP BY s.item_id
),
comp AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band) AS completed_stage
  FROM st s LEFT JOIN active a ON a.item_id = s.item_id
  WHERE s.state = 'done' AND NOT s.chain_excluded AND (a.bo IS NULL OR s.sort_order < a.bo)
  ORDER BY s.item_id, s.sort_order DESC
),
curr AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
                       'state', s.state) AS current_stage
  FROM st s JOIN active a ON a.item_id = s.item_id AND a.band = s.band
  WHERE s.state NOT IN ('na','none','done') AND NOT s.chain_excluded
  ORDER BY s.item_id, s.sort_order
)
SELECT i.id, (SELECT d FROM params), coalesce(g.stages,'{}'::jsonb),
  coalesce(g.denom,0), coalesce(g.done,0), coalesce(g.delayed,0), coalesce(g.na_count,0),
  coalesce(g.req_doc_done,0), coalesce(g.req_doc_total,0),
  a.band, a.bstate, coalesce(h.hdec_actual_count,0), coalesce(h.has_plan,false),
  c.completed_stage, cu.current_stage,
  pd.primary_delay, coalesce(b.delay_bucket,'[]'::jsonb),
  coalesce(bm.band_states,'{}'::jsonb),
  public.spl_judge_v3(i.is_excluded, i.latest_status, coalesce(g.denom,0),
                      pd.primary_delay IS NOT NULL, a.bstate)
FROM public.spl_items i
LEFT JOIN agg g ON g.item_id = i.id
LEFT JOIN active a ON a.item_id = i.id
LEFT JOIN bmap bm ON bm.item_id = i.id
LEFT JOIN hdec h ON h.item_id = i.id
LEFT JOIN pd ON pd.item_id = i.id
LEFT JOIN bucket b ON b.item_id = i.id
LEFT JOIN comp c ON c.item_id = i.id
LEFT JOIN curr cu ON cu.item_id = i.id
WHERE i.is_active
$$;

DROP FUNCTION IF EXISTS public.wrt_eval_as_of(date);
CREATE FUNCTION public.wrt_eval_as_of(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, as_of date, stages jsonb, denom integer, done integer,
  delayed integer, na_count integer, active_band text, active_band_state text,
  hdec_actual_count integer, has_plan boolean,
  completed_stage jsonb, current_stage jsonb, primary_delay jsonb, delay_bucket jsonb,
  response_wait jsonb, band_states jsonb, judgment text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
WITH params AS (SELECT coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS d),
st AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.band, c.sort_order, c.value_type,
         c.actual_authority, c.chain_excluded, c.round_no,
         p.plan_start, p.plan_finish, p.flag_value,
         (coalesce(p.na_flag,false)
          OR (c.round_no IS NOT NULL AND c.round_no > coalesce(i.active_round,1))) AS na_flag,
         CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END AS a_s,
         CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END AS a_f,
         public.wrt_stage_state(c.value_type, p.plan_start, p.plan_finish,
           CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END,
           CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END,
           p.flag_value,
           (coalesce(p.na_flag,false)
            OR (c.round_no IS NOT NULL AND c.round_no > coalesce(i.active_round,1))),
           (SELECT d FROM params)) AS state
  FROM public.wrt_items i
  CROSS JOIN public.wrt_stage_catalog c
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active
),
bandst AS (
  SELECT item_id, band, min(sort_order) AS bo,
         count(*) FILTER (WHERE state NOT IN ('na','none')) AS bdenom,
         count(*) FILTER (WHERE state NOT IN ('na','none','done')) AS bopen
  FROM st WHERE NOT chain_excluded GROUP BY item_id, band
),
bandst2 AS (
  SELECT *, CASE WHEN bdenom = 0 THEN 'empty' WHEN bopen > 0 THEN 'active' ELSE 'complete' END AS bstate
  FROM bandst
),
bmap AS (
  SELECT item_id, jsonb_object_agg(band, bstate) AS band_states FROM bandst2 GROUP BY item_id
),
active AS (
  SELECT DISTINCT ON (item_id) item_id, band, bo, bstate
  FROM bandst2 WHERE bstate <> 'complete' ORDER BY item_id, bo
),
hdec AS (
  SELECT s.item_id,
    count(*) FILTER (WHERE s.actual_authority = 'HDEC' AND coalesce(s.a_f, s.a_s) IS NOT NULL)::int AS hdec_actual_count,
    bool_or((s.plan_start IS NOT NULL OR s.plan_finish IS NOT NULL) AND s.actual_authority = 'HDEC') AS has_plan
  FROM st s GROUP BY s.item_id
),
agg AS (
  SELECT s.item_id,
    jsonb_object_agg(s.stage_code, jsonb_build_object(
      'ps', s.plan_start, 'pf', s.plan_finish, 'as', s.a_s, 'af', s.a_f,
      'fv', s.flag_value, 'na', s.na_flag, 'st', s.state)) AS stages,
    count(*) FILTER (WHERE s.state NOT IN ('na','none'))::int AS denom,
    count(*) FILTER (WHERE s.state = 'done')::int    AS done,
    count(*) FILTER (WHERE s.state = 'delayed')::int AS delayed,
    count(*) FILTER (WHERE s.state = 'na')::int      AS na_count
  FROM st s GROUP BY s.item_id
),
pd AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
      'round_no', s.round_no,
      'days', GREATEST(0, ((SELECT d FROM params) - coalesce(s.plan_finish, s.plan_start))::int)) AS primary_delay
  FROM st s JOIN active a ON a.item_id = s.item_id AND a.band = s.band
  WHERE s.state = 'delayed' AND s.actual_authority = 'HDEC'
  ORDER BY s.item_id, s.sort_order
),
bucket AS (
  SELECT s.item_id, jsonb_agg(jsonb_build_object('stage_code', s.stage_code, 'label', s.label,
           'band', s.band, 'round_no', s.round_no, 'authority', s.actual_authority) ORDER BY s.sort_order) AS delay_bucket
  FROM st s LEFT JOIN pd ON pd.item_id = s.item_id
  WHERE s.state = 'delayed'
    AND coalesce(pd.primary_delay->>'stage_code','') <> s.stage_code
  GROUP BY s.item_id
),
respwait AS (
  SELECT s.item_id, jsonb_agg(jsonb_build_object('stage_code', s.stage_code, 'label', s.label,
           'round_no', s.round_no) ORDER BY s.sort_order) AS response_wait
  FROM st s WHERE s.state = 'delayed' AND s.actual_authority <> 'HDEC'
  GROUP BY s.item_id
),
comp AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
                       'round_no', s.round_no) AS completed_stage
  FROM st s LEFT JOIN active a ON a.item_id = s.item_id
  WHERE s.state = 'done' AND (a.bo IS NULL OR s.sort_order < a.bo)
  ORDER BY s.item_id, s.sort_order DESC
),
curr AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
                       'round_no', s.round_no, 'state', s.state) AS current_stage
  FROM st s JOIN active a ON a.item_id = s.item_id AND a.band = s.band
  WHERE s.state NOT IN ('na','none','done')
  ORDER BY s.item_id, s.sort_order
)
SELECT i.id, (SELECT d FROM params), coalesce(g.stages,'{}'::jsonb),
  coalesce(g.denom,0), coalesce(g.done,0), coalesce(g.delayed,0), coalesce(g.na_count,0),
  a.band, a.bstate, coalesce(h.hdec_actual_count,0), coalesce(h.has_plan,false),
  c.completed_stage, cu.current_stage,
  pd.primary_delay, coalesce(b.delay_bucket,'[]'::jsonb), coalesce(rw.response_wait,'[]'::jsonb),
  coalesce(bm.band_states,'{}'::jsonb),
  public.wrt_judge_v3(i.is_excluded, i.is_final_approved, coalesce(g.denom,0),
                      pd.primary_delay IS NOT NULL, a.bstate)
FROM public.wrt_items i
LEFT JOIN agg g ON g.item_id = i.id
LEFT JOIN active a ON a.item_id = i.id
LEFT JOIN bmap bm ON bm.item_id = i.id
LEFT JOIN hdec h ON h.item_id = i.id
LEFT JOIN pd ON pd.item_id = i.id
LEFT JOIN bucket b ON b.item_id = i.id
LEFT JOIN respwait rw ON rw.item_id = i.id
LEFT JOIN comp c ON c.item_id = i.id
LEFT JOIN curr cu ON cu.item_id = i.id
WHERE i.is_active
$$;

DROP FUNCTION IF EXISTS public.spl_judge_v2(boolean, text, integer, boolean);
DROP FUNCTION IF EXISTS public.wrt_judge_v2(boolean, boolean, integer, boolean);

-- ============ 4. rows_as_of 확장 ============
CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_reqdoc jsonb; v_bands jsonb;
  v_viol_prec int; v_viol_imp int; v_viol_new int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'label', label, 'band', band,
           'value_type', value_type, 'actual_authority', actual_authority,
           'chain_excluded', chain_excluded, 'sort_order', sort_order) ORDER BY sort_order)
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
    'active_band', e.active_band, 'active_band_state', e.active_band_state,
    'band_states', e.band_states,
    'hdec_actual_count', e.hdec_actual_count, 'has_plan', e.has_plan,
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
$$;

CREATE OR REPLACE FUNCTION public.wrt_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_bands jsonb;
  v_viol_total int; v_viol_new int; v_viol_prec int; v_viol_ghost int;
  v_viol_resp int; v_viol_imp int; v_pending int; v_pending_r1 int; v_pending_r2 int;
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
    'active_band', e.active_band, 'active_band_state', e.active_band_state,
    'band_states', e.band_states,
    'hdec_actual_count', e.hdec_actual_count, 'has_plan', e.has_plan,
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
  SELECT jsonb_object_agg(band, cnt) INTO v_bands FROM (
    SELECT b.key AS band, jsonb_object_agg(b.state, b.n) AS cnt FROM (
      SELECT kv.key, kv.value #>> '{}' AS state, count(*) AS n
      FROM jsonb_array_elements(v_rows) r, jsonb_each(r->'band_states') kv
      GROUP BY 1,2) b GROUP BY 1) q2;

  SELECT count(*) FILTER (WHERE violation_type IN ('precedence','ghost_round','response_before_submission')),
         count(*) FILTER (WHERE violation_type = 'precedence'),
         count(*) FILTER (WHERE violation_type = 'ghost_round'),
         count(*) FILTER (WHERE violation_type = 'response_before_submission'),
         count(*) FILTER (WHERE violation_type = 'import_incomplete'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_1'),
         count(*) FILTER (WHERE violation_type = 'pending_hdec' AND stage_code = 'ROUND_2')
    INTO v_viol_total, v_viol_prec, v_viol_ghost, v_viol_resp, v_viol_imp,
         v_pending, v_pending_r1, v_pending_r2
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
   WHERE v_last_batch IS NOT NULL
     AND v.violation_type IN ('precedence','ghost_round','response_before_submission')
     AND EXISTS (SELECT 1 FROM public.wrt_change_log cl
                  WHERE cl.batch_id = v_last_batch AND cl.item_id = v.item_id);

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'catalog', coalesce(v_catalog, '[]'::jsonb),
    'rows', v_rows,
    'total_count', jsonb_array_length(v_rows),
    'judgment_counts', coalesce(v_counts, '{}'::jsonb),
    'band_state_counts', coalesce(v_bands, '{}'::jsonb),
    'hdec_missing_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0),
    'hdec_missing_done', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'hdec_actual_count')::int = 0 AND r->>'judgment' = '완료'),
    'plan_items', (SELECT count(*) FROM jsonb_array_elements(v_rows) r
                            WHERE (r->>'has_plan')::boolean),
    'violations', jsonb_build_object(
      'total', coalesce(v_viol_total,0),
      'precedence', coalesce(v_viol_prec,0),
      'ghost_round', coalesce(v_viol_ghost,0),
      'response_before_submission', coalesce(v_viol_resp,0),
      'import_incomplete', coalesce(v_viol_imp,0),
      'pending_hdec', coalesce(v_pending,0),
      'pending_hdec_r1', coalesce(v_pending_r1,0),
      'pending_hdec_r2', coalesce(v_pending_r2,0),
      'pending_hdec_items', coalesce(v_pending_items,0),
      'inspected_items', coalesce(v_inspected,0),
      'from_last_import', coalesce(v_viol_new,0),
      'last_batch_id', v_last_batch));
END;
$$;