CREATE OR REPLACE FUNCTION public.wrt_judge_v1(_as_of date DEFAULT NULL)
RETURNS TABLE(item_id uuid, judgment jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
WITH params AS (
  SELECT COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of,
         COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) < (now() AT TIME ZONE 'Asia/Qatar')::date AS v_past
),
rd AS (
  SELECT i.id,
    max(p.actual_start) FILTER (WHERE p.stage_code = 'RESPONSE_DATE_R1') AS rd1,
    max(p.actual_start) FILTER (WHERE p.stage_code = 'RESPONSE_DATE_R2') AS rd2
  FROM public.wrt_items i
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id
  GROUP BY i.id
),
ar AS (
  SELECT i.id,
    CASE WHEN
      (i.r2_response_code IS NOT NULL AND ((rd.rd2 IS NOT NULL AND rd.rd2 <= pa.as_of) OR (rd.rd2 IS NULL AND NOT pa.v_past)))
      OR (upper(btrim(coalesce(i.r1_response_code,''))) IN ('B','C')
          AND ((rd.rd1 IS NOT NULL AND rd.rd1 <= pa.as_of) OR (rd.rd1 IS NULL AND NOT pa.v_past)))
      OR EXISTS (
        SELECT 1 FROM public.wrt_stage_progress p2
        JOIN public.wrt_stage_catalog c2 ON c2.stage_code = p2.stage_code
        WHERE p2.item_id = i.id AND c2.round_no = 2 AND c2.value_type <> 'flag'
          AND NOT COALESCE(p2.na_flag, false)
          AND (CASE WHEN c2.value_type = 'range' THEN p2.actual_finish ELSE p2.actual_start END) IS NOT NULL
          AND (CASE WHEN c2.value_type = 'range' THEN p2.actual_finish ELSE p2.actual_start END) <= pa.as_of)
    THEN 2 ELSE 1 END AS active_round
  FROM public.wrt_items i CROSS JOIN params pa JOIN rd ON rd.id = i.id
),
st AS (
  SELECT i.id AS iid, c.stage_code, c.band, c.sort_order, c.actual_authority, c.round_no,
         pa.as_of,
         (CASE WHEN c.value_type = 'range' THEN p.actual_finish ELSE p.actual_start END) AS done_at,
         (CASE WHEN c.value_type = 'range' THEN p.plan_finish ELSE p.plan_start END) AS plan_at
  FROM public.wrt_items i
  CROSS JOIN params pa
  JOIN ar ON ar.id = i.id
  CROSS JOIN public.wrt_stage_catalog c
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE c.value_type <> 'flag'
    AND NOT COALESCE(p.na_flag, false)
    AND (c.round_no IS NULL OR c.round_no <= ar.active_round)
),
st2 AS (
  SELECT st.*, (done_at IS NOT NULL AND done_at <= as_of) AS complete FROM st
),
agg AS (
  SELECT iid,
    max(sort_order) FILTER (WHERE complete) AS comp_so,
    min(sort_order) FILTER (WHERE NOT complete) AS cur_so,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE plan_at IS NOT NULL AND plan_at < as_of AND NOT complete), '{}') AS delay_bucket,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE complete AND plan_at IS NOT NULL AND done_at > plan_at), '{}') AS delay_late,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL), false) AS needs_planning,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL AND round_no = 2), false) AS r2_noplan
  FROM st2 GROUP BY iid
),
bandagg AS (
  SELECT iid, jsonb_object_agg(band, jsonb_build_object(
    'completed_stage', cs, 'current_stage', cur, 'done', done, 'total', total)) AS bands
  FROM (
    SELECT iid, band,
      count(*) FILTER (WHERE complete) AS done, count(*) AS total,
      (array_agg(stage_code ORDER BY sort_order DESC) FILTER (WHERE complete))[1] AS cs,
      (array_agg(stage_code ORDER BY sort_order) FILTER (WHERE NOT complete))[1] AS cur
    FROM st2 GROUP BY iid, band
  ) b GROUP BY iid
),
base AS (
  SELECT i.id, pa.as_of, pa.v_past, ar.active_round, i.is_excluded,
         a.comp_so, a.cur_so, a.delay_bucket, a.delay_late, a.needs_planning, a.r2_noplan,
         cc.stage_code AS comp_code, cc.band AS comp_band,
         cu.stage_code AS cur_code, cu.band AS cur_band, cu.actual_authority AS cur_auth,
         sc.done_at AS comp_done_at,
         CASE WHEN ar.active_round = 2 THEN rd.rd2 ELSE rd.rd1 END AS appr_date,
         CASE WHEN ar.active_round = 2 THEN i.r2_response_code ELSE i.r1_response_code END AS act_code,
         i.is_final_approved, bg.bands
  FROM public.wrt_items i
  CROSS JOIN params pa
  JOIN ar ON ar.id = i.id
  JOIN rd ON rd.id = i.id
  LEFT JOIN agg a ON a.iid = i.id
  LEFT JOIN bandagg bg ON bg.iid = i.id
  LEFT JOIN public.wrt_stage_catalog cc ON cc.sort_order = a.comp_so
  LEFT JOIN public.wrt_stage_catalog cu ON cu.sort_order = a.cur_so
  LEFT JOIN st2 sc ON sc.iid = i.id AND sc.sort_order = a.comp_so
),
j AS (
  SELECT b.*,
    (COALESCE(b.is_final_approved,false)
      AND ((b.appr_date IS NOT NULL AND b.appr_date <= b.as_of) OR (b.appr_date IS NULL AND NOT b.v_past))) AS v_approved,
    (b.v_past AND (COALESCE(b.is_excluded,false)
      OR (COALESCE(b.is_final_approved,false) AND b.appr_date IS NULL))) AS ju
  FROM base b
),
k AS (
  SELECT j.*,
    CASE WHEN ju THEN 'NO_HISTORY'
         WHEN COALESCE(is_excluded,false) THEN 'EXCLUDED'
         WHEN v_approved THEN 'Approved'
         WHEN cur_code IS NOT NULL THEN cur_code
         ELSE 'DONE' END AS current_stage
  FROM j
)
SELECT k.id AS item_id,
  CASE WHEN ju THEN jsonb_build_object(
    'active_round', NULL, 'completed_stage', NULL, 'completed_stage_group', NULL,
    'current_stage', 'NO_HISTORY', 'bucket_top', 'NO_HISTORY',
    'delay_bucket', '[]'::jsonb, 'delay_late', '[]'::jsonb, 'primary_delay', NULL,
    'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
    'rs_result_missing', false, 'rs_date_missing', false, 'ur_aging_days', NULL,
    'judgment_unavailable', true, 'bands', '{}'::jsonb)
  ELSE jsonb_build_object(
    'active_round', active_round,
    'completed_stage', comp_code,
    'completed_stage_group', comp_band,
    'current_stage', current_stage,
    'bucket_top', CASE WHEN current_stage IN ('NO_HISTORY','EXCLUDED','Approved','DONE') THEN current_stage
                       WHEN cur_auth = 'ACONEX' THEN 'UR' ELSE cur_band END,
    'delay_bucket', to_jsonb(CASE WHEN needs_planning THEN COALESCE(delay_bucket,'{}') || ARRAY['NoPlan'] ELSE COALESCE(delay_bucket,'{}') END),
    'delay_late', to_jsonb(COALESCE(delay_late,'{}'::text[])),
    'primary_delay', CASE WHEN current_stage = ANY(COALESCE(delay_bucket,'{}')) THEN current_stage ELSE NULL END,
    'needs_planning', COALESCE(needs_planning,false),
    'needs_revise', (active_round = 2 AND upper(btrim(coalesce((SELECT r1_response_code FROM public.wrt_items w WHERE w.id = k.id),''))) IN ('B','C') AND COALESCE(r2_noplan,false)),
    'revise_source_round', CASE WHEN (active_round = 2 AND upper(btrim(coalesce((SELECT r1_response_code FROM public.wrt_items w WHERE w.id = k.id),''))) IN ('B','C') AND COALESCE(r2_noplan,false)) THEN 1 ELSE NULL END,
    'rs_result_missing', ((SELECT max(p.actual_start) FROM public.wrt_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'RESPONSE_DATE_R' || active_round::text) IS NOT NULL AND act_code IS NULL),
    'rs_date_missing', (act_code IS NOT NULL AND (SELECT max(p.actual_start) FROM public.wrt_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'RESPONSE_DATE_R' || active_round::text) IS NULL),
    'ur_aging_days', CASE WHEN current_stage NOT IN ('NO_HISTORY','EXCLUDED','Approved','DONE') AND cur_auth = 'ACONEX' AND comp_done_at IS NOT NULL THEN (as_of - comp_done_at) ELSE NULL END,
    'judgment_unavailable', false,
    'bands', COALESCE(bands, '{}'::jsonb))
  END AS judgment
FROM k
$fn$;

CREATE OR REPLACE FUNCTION public.wrt_judge_one(_item_id uuid, _as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT judgment FROM public.wrt_judge_v1(_as_of) WHERE item_id = _item_id
$fn$;

GRANT EXECUTE ON FUNCTION public.wrt_judge_v1(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wrt_judge_one(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.wrt_items_judged WITH (security_invoker = true) AS
SELECT i.*, j.judgment,
       j.judgment->>'active_round'     AS j_active_round,
       j.judgment->>'completed_stage'  AS j_completed_stage,
       j.judgment->>'current_stage'    AS j_current_stage,
       j.judgment->>'bucket_top'       AS j_bucket_top
  FROM public.wrt_items i
  JOIN public.wrt_judge_v1(NULL) j ON j.item_id = i.id;

GRANT SELECT ON public.wrt_items_judged TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.spl_judge_v1(_as_of date DEFAULT NULL)
RETURNS TABLE(item_id uuid, judgment jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
WITH params AS (
  SELECT COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of,
         COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) < (now() AT TIME ZONE 'Asia/Qatar')::date AS v_past
),
rd AS (
  SELECT i.id,
    max(p.actual_start) FILTER (WHERE p.stage_code = 'APPROVAL_DATE') AS appr,
    max(COALESCE(p.actual_finish, p.actual_start)) FILTER (WHERE p.stage_code = 'CODE_B_TO_A') AS cba
  FROM public.spl_items i
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id
  GROUP BY i.id
),
ar AS (
  SELECT i.id,
    CASE WHEN upper(btrim(coalesce(i.latest_status,''))) = 'B'
              AND rd.cba IS NOT NULL AND rd.cba <= pa.as_of
    THEN 2 ELSE 1 END AS active_round
  FROM public.spl_items i CROSS JOIN params pa JOIN rd ON rd.id = i.id
),
st AS (
  SELECT i.id AS iid, c.stage_code, c.band, c.sort_order, c.actual_authority, c.round_no,
         pa.as_of,
         (CASE WHEN c.value_type = 'range' THEN p.actual_finish ELSE p.actual_start END) AS done_at,
         (CASE WHEN c.value_type = 'range' THEN p.plan_finish ELSE p.plan_start END) AS plan_at
  FROM public.spl_items i
  CROSS JOIN params pa
  JOIN ar ON ar.id = i.id
  CROSS JOIN public.spl_stage_catalog c
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE c.value_type <> 'flag'
    AND NOT COALESCE(p.na_flag, false)
    AND (c.round_no IS NULL OR c.round_no <= ar.active_round)
),
st2 AS (
  SELECT st.*, (done_at IS NOT NULL AND done_at <= as_of) AS complete FROM st
),
agg AS (
  SELECT iid,
    max(sort_order) FILTER (WHERE complete) AS comp_so,
    min(sort_order) FILTER (WHERE NOT complete) AS cur_so,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE plan_at IS NOT NULL AND plan_at < as_of AND NOT complete), '{}') AS delay_bucket,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE complete AND plan_at IS NOT NULL AND done_at > plan_at), '{}') AS delay_late,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL), false) AS needs_planning,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL AND round_no = 2), false) AS r2_noplan
  FROM st2 GROUP BY iid
),
bandagg AS (
  SELECT iid, jsonb_object_agg(band, jsonb_build_object(
    'completed_stage', cs, 'current_stage', cur, 'done', done, 'total', total)) AS bands
  FROM (
    SELECT iid, band,
      count(*) FILTER (WHERE complete) AS done, count(*) AS total,
      (array_agg(stage_code ORDER BY sort_order DESC) FILTER (WHERE complete))[1] AS cs,
      (array_agg(stage_code ORDER BY sort_order) FILTER (WHERE NOT complete))[1] AS cur
    FROM st2 GROUP BY iid, band
  ) b GROUP BY iid
),
base AS (
  SELECT i.id, pa.as_of, pa.v_past, ar.active_round, i.is_excluded,
         a.comp_so, a.cur_so, a.delay_bucket, a.delay_late, a.needs_planning, a.r2_noplan,
         cc.stage_code AS comp_code, cc.band AS comp_band,
         cu.stage_code AS cur_code, cu.band AS cur_band, cu.actual_authority AS cur_auth,
         sc.done_at AS comp_done_at,
         rd.appr AS appr_date,
         i.latest_status AS act_code,
         (upper(btrim(coalesce(i.latest_status,''))) = 'A') AS is_final_approved, bg.bands
  FROM public.spl_items i
  CROSS JOIN params pa
  JOIN ar ON ar.id = i.id
  JOIN rd ON rd.id = i.id
  LEFT JOIN agg a ON a.iid = i.id
  LEFT JOIN bandagg bg ON bg.iid = i.id
  LEFT JOIN public.spl_stage_catalog cc ON cc.sort_order = a.comp_so
  LEFT JOIN public.spl_stage_catalog cu ON cu.sort_order = a.cur_so
  LEFT JOIN st2 sc ON sc.iid = i.id AND sc.sort_order = a.comp_so
),
j AS (
  SELECT b.*,
    (COALESCE(b.is_final_approved,false)
      AND ((b.appr_date IS NOT NULL AND b.appr_date <= b.as_of) OR (b.appr_date IS NULL AND NOT b.v_past))) AS v_approved,
    (b.v_past AND (COALESCE(b.is_excluded,false)
      OR (COALESCE(b.is_final_approved,false) AND b.appr_date IS NULL))) AS ju
  FROM base b
),
k AS (
  SELECT j.*,
    CASE WHEN ju THEN 'NO_HISTORY'
         WHEN COALESCE(is_excluded,false) THEN 'EXCLUDED'
         WHEN v_approved THEN 'Approved'
         WHEN cur_code IS NOT NULL THEN cur_code
         ELSE 'DONE' END AS current_stage
  FROM j
)
SELECT k.id AS item_id,
  CASE WHEN ju THEN jsonb_build_object(
    'active_round', NULL, 'completed_stage', NULL, 'completed_stage_group', NULL,
    'current_stage', 'NO_HISTORY', 'bucket_top', 'NO_HISTORY',
    'delay_bucket', '[]'::jsonb, 'delay_late', '[]'::jsonb, 'primary_delay', NULL,
    'needs_planning', false, 'needs_revise', false, 'revise_source_round', NULL,
    'rs_result_missing', false, 'rs_date_missing', false, 'ur_aging_days', NULL,
    'judgment_unavailable', true, 'bands', '{}'::jsonb)
  ELSE jsonb_build_object(
    'active_round', active_round,
    'completed_stage', comp_code,
    'completed_stage_group', comp_band,
    'current_stage', current_stage,
    'bucket_top', CASE WHEN current_stage IN ('NO_HISTORY','EXCLUDED','Approved','DONE') THEN current_stage
                       WHEN cur_auth = 'ACONEX' THEN 'UR' ELSE cur_band END,
    'delay_bucket', to_jsonb(CASE WHEN needs_planning THEN COALESCE(delay_bucket,'{}') || ARRAY['NoPlan'] ELSE COALESCE(delay_bucket,'{}') END),
    'delay_late', to_jsonb(COALESCE(delay_late,'{}'::text[])),
    'primary_delay', CASE WHEN current_stage = ANY(COALESCE(delay_bucket,'{}')) THEN current_stage ELSE NULL END,
    'needs_planning', COALESCE(needs_planning,false),
    'needs_revise', (active_round = 2 AND upper(btrim(coalesce((SELECT latest_status FROM public.spl_items w WHERE w.id = k.id),''))) = 'B' AND COALESCE(r2_noplan,false)),
    'revise_source_round', CASE WHEN (active_round = 2 AND upper(btrim(coalesce((SELECT latest_status FROM public.spl_items w WHERE w.id = k.id),''))) = 'B' AND COALESCE(r2_noplan,false)) THEN 1 ELSE NULL END,
    'rs_result_missing', ((SELECT max(p.actual_start) FROM public.spl_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'APPROVAL_DATE') IS NOT NULL AND act_code IS NULL),
    'rs_date_missing', (act_code IS NOT NULL AND (SELECT max(p.actual_start) FROM public.spl_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'APPROVAL_DATE') IS NULL),
    'ur_aging_days', CASE WHEN current_stage NOT IN ('NO_HISTORY','EXCLUDED','Approved','DONE') AND cur_auth = 'ACONEX' AND comp_done_at IS NOT NULL THEN (as_of - comp_done_at) ELSE NULL END,
    'judgment_unavailable', false,
    'bands', COALESCE(bands, '{}'::jsonb))
  END AS judgment
FROM k
$fn$;

CREATE OR REPLACE FUNCTION public.spl_judge_one(_item_id uuid, _as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT judgment FROM public.spl_judge_v1(_as_of) WHERE item_id = _item_id
$fn$;

GRANT EXECUTE ON FUNCTION public.spl_judge_v1(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spl_judge_one(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.spl_items_judged WITH (security_invoker = true) AS
SELECT i.*, j.judgment,
       j.judgment->>'active_round'     AS j_active_round,
       j.judgment->>'completed_stage'  AS j_completed_stage,
       j.judgment->>'current_stage'    AS j_current_stage,
       j.judgment->>'bucket_top'       AS j_bucket_top
  FROM public.spl_items i
  JOIN public.spl_judge_v1(NULL) j ON j.item_id = i.id;

GRANT SELECT ON public.spl_items_judged TO authenticated, service_role;