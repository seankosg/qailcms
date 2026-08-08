-- ═══════════════════════════════════════════════════════════
-- A-1. short_code
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.wrt_stage_catalog ADD COLUMN IF NOT EXISTS short_code text;
ALTER TABLE public.spl_stage_catalog ADD COLUMN IF NOT EXISTS short_code text;

UPDATE public.wrt_stage_catalog c SET short_code = v.sc
FROM (VALUES
  ('REQ_SUBMISSION','C-RF'), ('RESPONSE_RECEIVED','C-RV'),
  ('NEGOTIATION','C-NE'), ('CONFIRM_QUOTATION','C-CQ'),
  ('DRAFT_DOC_R1','D-DR1'), ('SUBMISSION_R1','D-SB1'), ('RESPONSE_DATE_R1','D-RS1'),
  ('DRAFT_DOC_R2','D-DR2'), ('SUBMISSION_R2','D-SB2'), ('RESPONSE_DATE_R2','D-RS2'),
  ('DOC_PREPARATION','S-PR'), ('SUBCON_STAMP','S-SM'), ('FINAL_SUBMISSION','S-SB')
) AS v(code, sc) WHERE c.stage_code = v.code;

UPDATE public.spl_stage_catalog c SET short_code = v.sc
FROM (VALUES
  ('PHYSICAL_LIST','R-PL'), ('REC_LETTER_2Y','R-2Y'), ('REC_LETTER_5Y','R-5Y'),
  ('AVAILABILITY_10Y','R-10Y'), ('OTHERS_DOC','R-OT'),
  ('REQ_RESUBMISSION','D-SU'), ('RESPONSE_RECEIVED','D-RV'), ('REVIEW_RESPONSE','D-VW'),
  ('INTERNAL_QTY_VERIF','D-QV'), ('SUBSTANTIATION_PREP','D-PR'), ('DAR_ACCEPTANCE','D-DA'),
  ('SUBMISSION','D-SB'), ('APPROVAL_DATE','D-AP'), ('CODE_B_TO_A','D-BA'),
  ('RFQ_DRAFT','P-QD'), ('RFQ','P-RQ'), ('QUOTATION','P-QT'),
  ('REVIEW_QUOTATION','P-WQ'), ('CONFIRM_QUOTATION','P-CQ'), ('HQ_APPROVAL','P-HQ'),
  ('MRS','P-MR'), ('PO_ISSUANCE','P-PO')
) AS v(code, sc) WHERE c.stage_code = v.code;

ALTER TABLE public.wrt_stage_catalog ALTER COLUMN short_code SET NOT NULL;
ALTER TABLE public.spl_stage_catalog ALTER COLUMN short_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wrt_stage_catalog_short_code_key ON public.wrt_stage_catalog(short_code);
CREATE UNIQUE INDEX IF NOT EXISTS spl_stage_catalog_short_code_key ON public.spl_stage_catalog(short_code);

-- ═══════════════════════════════════════════════════════════
-- E-2. Required Document flag 값 정규화 (일회)
--   'N/A' · 'NA' → 'N/A' (불필요) / 그 외 비어있지 않은 값 → 'REQUIRED' (필요)
-- ═══════════════════════════════════════════════════════════
UPDATE public.spl_stage_progress p SET flag_value = 'N/A'
FROM public.spl_stage_catalog c
WHERE c.stage_code = p.stage_code AND c.band = 'REQUIRED_DOC'
  AND upper(btrim(coalesce(p.flag_value,''))) IN ('N/A','NA','N.A.');

UPDATE public.spl_stage_progress p SET flag_value = 'REQUIRED'
FROM public.spl_stage_catalog c
WHERE c.stage_code = p.stage_code AND c.band = 'REQUIRED_DOC'
  AND nullif(btrim(coalesce(p.flag_value,'')),'') IS NOT NULL
  AND upper(btrim(p.flag_value)) <> 'N/A';

-- ═══════════════════════════════════════════════════════════
-- B-3. 라운드 정본 함수 (판정 · 조회 · 검사 뷰가 공유)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_active_round(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, active_round smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
)
SELECT i.id,
  (CASE WHEN
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
  THEN 2 ELSE 1 END)::smallint
FROM public.wrt_items i CROSS JOIN params pa JOIN rd ON rd.id = i.id
$function$;

CREATE OR REPLACE FUNCTION public.spl_active_round(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, active_round smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH params AS (SELECT COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of),
cba AS (
  SELECT i.id,
    max(COALESCE(p.actual_finish, p.actual_start)) FILTER (WHERE p.stage_code = 'CODE_B_TO_A') AS d
  FROM public.spl_items i
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id
  GROUP BY i.id
)
SELECT i.id,
  (CASE WHEN (cba.d IS NOT NULL AND cba.d <= pa.as_of)
             OR upper(btrim(coalesce(i.latest_status,''))) IN ('B','C')
        THEN 2 ELSE 1 END)::smallint
FROM public.spl_items i CROSS JOIN params pa JOIN cba ON cba.id = i.id
$function$;

GRANT EXECUTE ON FUNCTION public.wrt_active_round(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spl_active_round(date) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- B-1 / B-2. 판정 정본 — 밴드 종료 조건 · 단계 표시
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_judge_v1(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, judgment jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH params AS (
  SELECT COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of,
         COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) < (now() AT TIME ZONE 'Asia/Qatar')::date AS v_past
),
rd AS (
  SELECT i.id,
    max(p.actual_start)  FILTER (WHERE p.stage_code = 'RESPONSE_DATE_R1') AS rd1,
    max(p.actual_start)  FILTER (WHERE p.stage_code = 'RESPONSE_DATE_R2') AS rd2,
    max(p.actual_start)  FILTER (WHERE p.stage_code = 'CONFIRM_QUOTATION') AS cq,
    max(p.actual_finish) FILTER (WHERE p.stage_code = 'FINAL_SUBMISSION')  AS fs
  FROM public.wrt_items i
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id
  GROUP BY i.id
),
ar AS (SELECT item_id AS id, active_round FROM public.wrt_active_round(_as_of)),
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
st2 AS (SELECT st.*, (done_at IS NOT NULL AND done_at <= as_of) AS complete FROM st),
agg AS (
  SELECT iid,
    max(sort_order) FILTER (WHERE complete) AS comp_so,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE plan_at IS NOT NULL AND plan_at < as_of AND NOT complete), '{}') AS delay_bucket,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE complete AND plan_at IS NOT NULL AND done_at > plan_at), '{}') AS delay_late,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL), false) AS needs_planning,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL AND round_no = 2), false) AS r2_noplan
  FROM st2 GROUP BY iid
),
bandsort AS (SELECT band, min(sort_order) AS bo FROM public.wrt_stage_catalog GROUP BY band),
bandclosed AS (
  SELECT i.id AS iid, b.band, b.bo,
    CASE b.band
      WHEN 'COMMERCIAL'     THEN (rd.cq IS NOT NULL AND rd.cq <= pa.as_of)
      WHEN 'DRAFT_APPROVAL' THEN (upper(btrim(coalesce(i.latest_response_code,''))) = 'A'
             AND ((CASE WHEN ar.active_round = 2 THEN rd.rd2 ELSE rd.rd1 END) IS NOT NULL
                    AND (CASE WHEN ar.active_round = 2 THEN rd.rd2 ELSE rd.rd1 END) <= pa.as_of
                  OR (CASE WHEN ar.active_round = 2 THEN rd.rd2 ELSE rd.rd1 END) IS NULL AND NOT pa.v_past))
      WHEN 'SUBMISSION'     THEN (rd.fs IS NOT NULL AND rd.fs <= pa.as_of)
      ELSE false END AS closed
  FROM public.wrt_items i
  CROSS JOIN params pa
  JOIN ar ON ar.id = i.id
  JOIN rd ON rd.id = i.id
  CROSS JOIN bandsort b
),
curband AS (
  SELECT DISTINCT ON (bc.iid) bc.iid, bc.band, bc.bo
  FROM bandclosed bc
  WHERE NOT bc.closed
    AND EXISTS (SELECT 1 FROM st2 WHERE st2.iid = bc.iid AND st2.band = bc.band AND NOT st2.complete)
  ORDER BY bc.iid, bc.bo
),
curstage AS (
  SELECT DISTINCT ON (s.iid) s.iid, s.sort_order AS cur_so
  FROM st2 s JOIN curband cb ON cb.iid = s.iid AND cb.band = s.band
  WHERE NOT s.complete
  ORDER BY s.iid, s.sort_order
),
bandagg AS (
  SELECT iid, jsonb_object_agg(band, jsonb_build_object(
    'completed_stage', cs, 'current_stage', cur, 'done', done, 'total', total, 'closed', closed)) AS bands
  FROM (
    SELECT s.iid, s.band,
      count(*) FILTER (WHERE s.complete) AS done, count(*) AS total,
      (array_agg(s.stage_code ORDER BY s.sort_order DESC) FILTER (WHERE s.complete))[1] AS cs,
      (array_agg(s.stage_code ORDER BY s.sort_order) FILTER (WHERE NOT s.complete))[1] AS cur,
      bool_or(bc.closed) AS closed
    FROM st2 s LEFT JOIN bandclosed bc ON bc.iid = s.iid AND bc.band = s.band
    GROUP BY s.iid, s.band
  ) b GROUP BY iid
),
base AS (
  SELECT i.id, pa.as_of, pa.v_past, ar.active_round, i.is_excluded,
         a.comp_so, cs.cur_so, a.delay_bucket, a.delay_late, a.needs_planning, a.r2_noplan,
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
  LEFT JOIN curstage cs ON cs.iid = i.id
  LEFT JOIN bandagg bg ON bg.iid = i.id
  LEFT JOIN public.wrt_stage_catalog cc ON cc.sort_order = a.comp_so
  LEFT JOIN public.wrt_stage_catalog cu ON cu.sort_order = cs.cur_so
  LEFT JOIN st2 sc ON sc.iid = i.id AND sc.sort_order = a.comp_so
),
j AS (
  SELECT b.*,
    (b.v_past AND (COALESCE(b.is_excluded,false)
      OR (COALESCE(b.is_final_approved,false) AND b.appr_date IS NULL))) AS ju
  FROM base b
),
k AS (
  SELECT j.*,
    CASE WHEN ju THEN 'NO_HISTORY'
         WHEN COALESCE(is_excluded,false) THEN 'EXCLUDED'
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
    'bucket_top', CASE WHEN current_stage IN ('NO_HISTORY','EXCLUDED','DONE') THEN current_stage
                       WHEN cur_auth = 'ACONEX' THEN 'UR' ELSE cur_band END,
    'delay_bucket', to_jsonb(CASE WHEN needs_planning THEN COALESCE(delay_bucket,'{}') || ARRAY['NoPlan'] ELSE COALESCE(delay_bucket,'{}') END),
    'delay_late', to_jsonb(COALESCE(delay_late,'{}'::text[])),
    'primary_delay', CASE WHEN current_stage = ANY(COALESCE(delay_bucket,'{}')) THEN current_stage ELSE NULL END,
    'needs_planning', COALESCE(needs_planning,false),
    'needs_revise', (active_round = 2 AND upper(btrim(coalesce((SELECT r1_response_code FROM public.wrt_items w WHERE w.id = k.id),''))) IN ('B','C') AND COALESCE(r2_noplan,false)),
    'revise_source_round', CASE WHEN (active_round = 2 AND upper(btrim(coalesce((SELECT r1_response_code FROM public.wrt_items w WHERE w.id = k.id),''))) IN ('B','C') AND COALESCE(r2_noplan,false)) THEN 1 ELSE NULL END,
    'rs_result_missing', ((SELECT max(p.actual_start) FROM public.wrt_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'RESPONSE_DATE_R' || active_round::text) IS NOT NULL AND act_code IS NULL),
    'rs_date_missing', (act_code IS NOT NULL AND (SELECT max(p.actual_start) FROM public.wrt_stage_progress p WHERE p.item_id = k.id AND p.stage_code = 'RESPONSE_DATE_R' || active_round::text) IS NULL),
    'ur_aging_days', CASE WHEN current_stage NOT IN ('NO_HISTORY','EXCLUDED','DONE') AND cur_auth = 'ACONEX' AND comp_done_at IS NOT NULL THEN (as_of - comp_done_at) ELSE NULL END,
    'judgment_unavailable', false,
    'bands', COALESCE(bands, '{}'::jsonb))
  END AS judgment
FROM k
$function$;

CREATE OR REPLACE FUNCTION public.spl_judge_v1(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, judgment jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH params AS (
  SELECT COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS as_of,
         COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) < (now() AT TIME ZONE 'Asia/Qatar')::date AS v_past
),
rd AS (
  SELECT i.id,
    max(p.actual_start) FILTER (WHERE p.stage_code = 'APPROVAL_DATE') AS appr,
    max(p.actual_start) FILTER (WHERE p.stage_code = 'PO_ISSUANCE')   AS po
  FROM public.spl_items i
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id
  GROUP BY i.id
),
ar AS (SELECT item_id AS id, active_round FROM public.spl_active_round(_as_of)),
reqdoc AS (
  SELECT i.id,
    count(*) FILTER (WHERE upper(btrim(coalesce(p.flag_value,''))) = 'REQUIRED')::int AS req_total,
    count(*) FILTER (WHERE upper(btrim(coalesce(p.flag_value,''))) = 'REQUIRED'
                       AND p.actual_start IS NOT NULL AND p.actual_start <= pa.as_of)::int AS req_ready
  FROM public.spl_items i
  CROSS JOIN params pa
  LEFT JOIN public.spl_stage_catalog c ON c.band = 'REQUIRED_DOC'
  LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  GROUP BY i.id
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
st2 AS (SELECT st.*, (done_at IS NOT NULL AND done_at <= as_of) AS complete FROM st),
agg AS (
  SELECT iid,
    max(sort_order) FILTER (WHERE complete) AS comp_so,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE plan_at IS NOT NULL AND plan_at < as_of AND NOT complete), '{}') AS delay_bucket,
    COALESCE(array_agg(stage_code ORDER BY sort_order) FILTER (WHERE complete AND plan_at IS NOT NULL AND done_at > plan_at), '{}') AS delay_late,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL), false) AS needs_planning,
    COALESCE(bool_or(NOT complete AND plan_at IS NULL AND round_no = 2), false) AS r2_noplan
  FROM st2 GROUP BY iid
),
bandsort AS (SELECT band, min(sort_order) AS bo FROM public.spl_stage_catalog GROUP BY band),
bandclosed AS (
  SELECT i.id AS iid, b.band, b.bo,
    CASE b.band
      WHEN 'REQUIRED_DOC'  THEN (rq.req_total = 0 OR rq.req_ready >= rq.req_total)
      WHEN 'DOCUMENTATION' THEN (upper(btrim(coalesce(i.latest_status,''))) = 'A'
             AND ((rd.appr IS NOT NULL AND rd.appr <= pa.as_of) OR (rd.appr IS NULL AND NOT pa.v_past)))
      WHEN 'PO'            THEN (rd.po IS NOT NULL AND rd.po <= pa.as_of)
      ELSE false END AS closed
  FROM public.spl_items i
  CROSS JOIN params pa
  JOIN rd ON rd.id = i.id
  JOIN reqdoc rq ON rq.id = i.id
  CROSS JOIN bandsort b
),
curband AS (
  SELECT DISTINCT ON (bc.iid) bc.iid, bc.band, bc.bo
  FROM bandclosed bc
  WHERE NOT bc.closed
    AND EXISTS (SELECT 1 FROM st2 WHERE st2.iid = bc.iid AND st2.band = bc.band AND NOT st2.complete)
  ORDER BY bc.iid, bc.bo
),
curstage AS (
  SELECT DISTINCT ON (s.iid) s.iid, s.sort_order AS cur_so
  FROM st2 s JOIN curband cb ON cb.iid = s.iid AND cb.band = s.band
  WHERE NOT s.complete
  ORDER BY s.iid, s.sort_order
),
bandagg AS (
  SELECT iid, jsonb_object_agg(band, jsonb_build_object(
    'completed_stage', cs, 'current_stage', cur, 'done', done, 'total', total, 'closed', closed)) AS bands
  FROM (
    SELECT s.iid, s.band,
      count(*) FILTER (WHERE s.complete) AS done, count(*) AS total,
      (array_agg(s.stage_code ORDER BY s.sort_order DESC) FILTER (WHERE s.complete))[1] AS cs,
      (array_agg(s.stage_code ORDER BY s.sort_order) FILTER (WHERE NOT s.complete))[1] AS cur,
      bool_or(bc.closed) AS closed
    FROM st2 s LEFT JOIN bandclosed bc ON bc.iid = s.iid AND bc.band = s.band
    GROUP BY s.iid, s.band
  ) b GROUP BY iid
),
base AS (
  SELECT i.id, pa.as_of, pa.v_past, ar.active_round, i.is_excluded,
         a.comp_so, cs.cur_so, a.delay_bucket, a.delay_late, a.needs_planning, a.r2_noplan,
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
  LEFT JOIN curstage cs ON cs.iid = i.id
  LEFT JOIN bandagg bg ON bg.iid = i.id
  LEFT JOIN public.spl_stage_catalog cc ON cc.sort_order = a.comp_so
  LEFT JOIN public.spl_stage_catalog cu ON cu.sort_order = cs.cur_so
  LEFT JOIN st2 sc ON sc.iid = i.id AND sc.sort_order = a.comp_so
),
j AS (
  SELECT b.*,
    (b.v_past AND (COALESCE(b.is_excluded,false)
      OR (COALESCE(b.is_final_approved,false) AND b.appr_date IS NULL))) AS ju
  FROM base b
),
k AS (
  SELECT j.*,
    CASE WHEN ju THEN 'NO_HISTORY'
         WHEN COALESCE(is_excluded,false) THEN 'EXCLUDED'
         WHEN cur_code IS NOT NULL THEN cur_code
         ELSE 'DONE' END AS current_stage
  FROM j
)
SELECT k.id AS item_id,
  CASE WHEN ju THEN jsonb_build_object(
    'active_round', NULL, 'completed_stage', NULL, 'completed_stage_group', NULL,
    'current_stage', 'NO_HISTORY', 'bucket_top', 'NO_HISTORY',
    'delay_bucket', '[]'::jsonb, 'delay_late', '[]'::jsonb, 'primary_delay', NULL,
    'needs_planning', false, 'judgment_unavailable', true, 'bands', '{}'::jsonb)
  ELSE jsonb_build_object(
    'active_round', active_round,
    'completed_stage', comp_code,
    'completed_stage_group', comp_band,
    'current_stage', current_stage,
    'bucket_top', CASE WHEN current_stage IN ('NO_HISTORY','EXCLUDED','DONE') THEN current_stage
                       WHEN cur_auth = 'ACONEX' THEN 'UR' ELSE cur_band END,
    'delay_bucket', to_jsonb(CASE WHEN needs_planning THEN COALESCE(delay_bucket,'{}') || ARRAY['NoPlan'] ELSE COALESCE(delay_bucket,'{}') END),
    'delay_late', to_jsonb(COALESCE(delay_late,'{}'::text[])),
    'primary_delay', CASE WHEN current_stage = ANY(COALESCE(delay_bucket,'{}')) THEN current_stage ELSE NULL END,
    'needs_planning', COALESCE(needs_planning,false),
    'judgment_unavailable', false,
    'bands', COALESCE(bands, '{}'::jsonb))
  END AS judgment
FROM k
$function$;

-- ═══════════════════════════════════════════════════════════
-- B-4. eval_as_of 내부 소스 교체 + B-7 judge_v3 인라인
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_eval_as_of(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, as_of date, stages jsonb, denom integer, done integer, delayed integer, na_count integer, active_band text, active_band_state text, hdec_actual_count integer, has_plan boolean, completed_stage jsonb, current_stage jsonb, primary_delay jsonb, delay_bucket jsonb, response_wait jsonb, band_states jsonb, judgment text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
WITH params AS (SELECT coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date) AS d),
ar AS (SELECT item_id AS id, active_round FROM public.wrt_active_round(_as_of)),
st AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.band, c.sort_order, c.value_type,
         c.actual_authority, c.chain_excluded, c.round_no,
         p.plan_start, p.plan_finish, p.flag_value,
         (coalesce(p.na_flag,false)
          OR (c.round_no IS NOT NULL AND c.round_no > ar.active_round)) AS na_flag,
         CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END AS a_s,
         CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END AS a_f,
         public.wrt_stage_state(c.value_type, p.plan_start, p.plan_finish,
           CASE WHEN p.actual_start  <= (SELECT d FROM params) THEN p.actual_start  END,
           CASE WHEN p.actual_finish <= (SELECT d FROM params) THEN p.actual_finish END,
           p.flag_value,
           (coalesce(p.na_flag,false)
            OR (c.round_no IS NOT NULL AND c.round_no > ar.active_round)),
           (SELECT d FROM params)) AS state
  FROM public.wrt_items i
  JOIN ar ON ar.id = i.id
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
bmap AS (SELECT item_id, jsonb_object_agg(band, bstate) AS band_states FROM bandst2 GROUP BY item_id),
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
  CASE
    WHEN coalesce(i.is_excluded,false) THEN '제외'
    WHEN coalesce(i.is_final_approved,false) THEN '완료'
    WHEN coalesce(g.denom,0) = 0 THEN '미분류'
    WHEN pd.primary_delay IS NOT NULL THEN '지연'
    WHEN a.bstate = 'empty' THEN '미착수'
    ELSE '정상'
  END
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
$function$;

CREATE OR REPLACE FUNCTION public.spl_eval_as_of(_as_of date DEFAULT NULL::date)
RETURNS TABLE(item_id uuid, as_of date, stages jsonb, denom integer, done integer, delayed integer, na_count integer, req_doc_done integer, req_doc_total integer, active_band text, active_band_state text, hdec_actual_count integer, has_plan boolean, completed_stage jsonb, current_stage jsonb, primary_delay jsonb, delay_bucket jsonb, band_states jsonb, judgment text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
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
bmap AS (SELECT item_id, jsonb_object_agg(band, bstate) AS band_states FROM bandst2 GROUP BY item_id),
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
    count(*) FILTER (WHERE s.chain_excluded AND upper(btrim(coalesce(s.flag_value,''))) = 'REQUIRED'
                       AND s.a_s IS NOT NULL)::int                            AS req_doc_done,
    count(*) FILTER (WHERE s.chain_excluded AND upper(btrim(coalesce(s.flag_value,''))) = 'REQUIRED')::int AS req_doc_total
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
  CASE
    WHEN coalesce(i.is_excluded,false) THEN '제외'
    WHEN coalesce(i.latest_status,'') = 'A' THEN '완료'
    WHEN coalesce(g.denom,0) = 0 THEN '미분류'
    WHEN pd.primary_delay IS NOT NULL THEN '지연'
    WHEN a.bstate = 'empty' THEN '미착수'
    ELSE '정상'
  END
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
$function$;

DROP FUNCTION IF EXISTS public.wrt_judge_v3(boolean, boolean, integer, boolean, text);
DROP FUNCTION IF EXISTS public.spl_judge_v3(boolean, text, integer, boolean, text);

-- ═══════════════════════════════════════════════════════════
-- B-4/B-5. 뷰 재작성 + wrt_items.active_round 제거
-- ═══════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.wrt_items_judged;
DROP VIEW IF EXISTS public.wrt_precedence_violations;
ALTER TABLE public.wrt_items DROP COLUMN IF EXISTS active_round;

CREATE VIEW public.wrt_precedence_violations AS
WITH ar AS (SELECT item_id, active_round FROM public.wrt_active_round(NULL::date)),
grid AS (
  SELECT i.id AS item_id, c.stage_code, c.label, c.sort_order,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any,
         (p.item_id IS NOT NULL) AS has_row
  FROM public.wrt_items i
  JOIN ar ON ar.item_id = i.id
  CROSS JOIN public.wrt_stage_catalog c
  LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
  WHERE i.is_active AND c.actual_authority = 'HDEC' AND c.value_type <> 'flag' AND NOT c.chain_excluded
    AND (c.round_no IS NULL OR c.round_no <= ar.active_round)
), prec AS (
  SELECT CASE WHEN m.rows_present = 0 THEN 'import_incomplete' ELSE 'precedence' END AS violation_type,
    g.item_id, i.wrt_number, i.plot, i.team, g.stage_code, g.label, g.sort_order,
    g.actual_any AS actual_date, m.missing_predecessors,
    CASE WHEN m.rows_present = 0 THEN 'Predecessor data not imported (no progress row)'
         ELSE 'Actual recorded while predecessor stage has no actual' END AS detail
  FROM grid g
  JOIN public.wrt_items i ON i.id = g.item_id
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS missing_predecessors,
           (count(*) FILTER (WHERE pr.has_row))::integer AS rows_present
    FROM grid pr WHERE pr.item_id = g.item_id AND pr.sort_order < g.sort_order AND pr.actual_any IS NULL) m
  WHERE g.actual_any IS NOT NULL AND m.missing_predecessors > 0
), sub_any AS (
  SELECT i.id AS item_id,
    EXISTS (SELECT 1 FROM public.wrt_stage_progress p
             WHERE p.item_id = i.id AND p.stage_code = ANY (ARRAY['SUBMISSION_R1','SUBMISSION_R2'])
               AND COALESCE(p.actual_finish, p.actual_start) IS NOT NULL) AS has_sub
  FROM public.wrt_items i
), rounds AS (
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
), rnd AS (
  SELECT c.vtype AS violation_type, c.item_id, c.wrt_number, c.plot, c.team,
    ('ROUND_' || c.n) AS stage_code, ('Round ' || c.n) AS label, (c.n * 1000) AS sort_order,
    c.resp_actual AS actual_date, 0 AS missing_predecessors,
    CASE c.vtype
      WHEN 'pending_hdec' THEN 'Aconex response exists while HDEC submission actual is absent (not a violation)'
      WHEN 'ghost_round'  THEN 'Response exists without a submission actual for this round'
      ELSE 'Response date precedes submission actual' END AS detail
  FROM (
    SELECT r.*,
      CASE WHEN r.sub_actual IS NULL AND NOT r.has_sub THEN 'pending_hdec'
           WHEN r.sub_actual IS NULL AND r.has_sub THEN 'ghost_round'
           WHEN r.resp_actual IS NOT NULL AND r.resp_actual < r.sub_actual THEN 'response_before_submission'
           ELSE NULL END AS vtype
    FROM rounds r WHERE r.resp_actual IS NOT NULL OR r.resp_code IS NOT NULL) c
  WHERE c.vtype IS NOT NULL
)
SELECT violation_type, item_id, wrt_number, plot, team, stage_code, label, sort_order,
       actual_date, missing_predecessors, detail FROM prec
UNION ALL
SELECT violation_type, item_id, wrt_number, plot, team, stage_code, label, sort_order,
       actual_date, missing_predecessors, detail FROM rnd;

CREATE VIEW public.wrt_items_judged AS
SELECT i.id, i.wrt_number, i.plot, i.team, i.dis, i.service, i.title, i.pic, i.eng,
  i.r1_response_code, i.r1_response_code_raw, i.r2_response_code, i.r2_response_code_raw,
  i.latest_response_code, i.latest_status_raw, i.is_final_approved, i.final_approved_raw,
  i.response_source, i.is_active, i.is_excluded, i.exclusion_reason, i.data_date,
  i.source_file, i.created_at, i.updated_at, i.created_by, i.updated_by, i.owner_user_id,
  j.judgment,
  (j.judgment ->> 'active_round')    AS j_active_round,
  (j.judgment ->> 'completed_stage') AS j_completed_stage,
  (j.judgment ->> 'current_stage')   AS j_current_stage,
  (j.judgment ->> 'bucket_top')      AS j_bucket_top
FROM public.wrt_items i
JOIN public.wrt_judge_v1(NULL::date) j(item_id, judgment) ON j.item_id = i.id;

GRANT SELECT ON public.wrt_precedence_violations TO authenticated, service_role;
GRANT SELECT ON public.wrt_items_judged TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- C-1. 쓰기 가드 검사 함수 + 메시지 빌더
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_rule_msg(_num text, _code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
SELECT format(
  E'%s: Final Submission actual finish (S-SB-AF) cannot be recorded.\nDraft & Approval is not approved yet (current response code: %s).\nApproval (code A) is required before final submission.',
  _num, CASE WHEN coalesce(btrim(_code),'') = '' THEN 'none' ELSE upper(btrim(_code)) END)
$function$;

CREATE OR REPLACE FUNCTION public.spl_rule_msg(_num text, _ready int, _total int, _missing text[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
SELECT format(
  E'%s: Submission actual finish (D-SB-AF) cannot be recorded.\nRequired documents are not complete (%s of %s ready: missing %s).\nAll required documents must be marked ready before submission.',
  _num, _ready, _total, array_to_string(coalesce(_missing, '{}'::text[]), ', '))
$function$;

CREATE OR REPLACE FUNCTION public.wrt_assert_row_rules(_item_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_num text; v_code text; v_af date;
BEGIN
  SELECT i.wrt_number, coalesce(i.latest_response_code,'') INTO v_num, v_code
    FROM public.wrt_items i WHERE i.id = _item_id;
  IF v_num IS NULL THEN RETURN; END IF;
  SELECT p.actual_finish INTO v_af FROM public.wrt_stage_progress p
    WHERE p.item_id = _item_id AND p.stage_code = 'FINAL_SUBMISSION';
  IF v_af IS NOT NULL AND upper(btrim(v_code)) <> 'A' THEN
    RAISE EXCEPTION '%', public.wrt_rule_msg(v_num, v_code) USING ERRCODE = '23514';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.spl_assert_row_rules(_item_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_num text; v_af date; v_total int; v_ready int; v_missing text[];
BEGIN
  SELECT i.spl_number INTO v_num FROM public.spl_items i WHERE i.id = _item_id;
  IF v_num IS NULL THEN RETURN; END IF;
  SELECT p.actual_finish INTO v_af FROM public.spl_stage_progress p
    WHERE p.item_id = _item_id AND p.stage_code = 'SUBMISSION';
  IF v_af IS NULL THEN RETURN; END IF;
  SELECT count(*)::int,
         count(*) FILTER (WHERE p.actual_start IS NOT NULL)::int,
         coalesce(array_agg(c.short_code ORDER BY c.sort_order) FILTER (WHERE p.actual_start IS NULL), '{}'::text[])
    INTO v_total, v_ready, v_missing
    FROM public.spl_stage_catalog c
    JOIN public.spl_stage_progress p ON p.item_id = _item_id AND p.stage_code = c.stage_code
   WHERE c.band = 'REQUIRED_DOC' AND upper(btrim(coalesce(p.flag_value,''))) = 'REQUIRED';
  IF coalesce(v_total,0) > 0 AND v_ready < v_total THEN
    RAISE EXCEPTION '%', public.spl_rule_msg(v_num, v_ready, v_total, v_missing) USING ERRCODE = '23514';
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.wrt_assert_row_rules(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spl_assert_row_rules(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wrt_rule_msg(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spl_rule_msg(text, int, int, text[]) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- C-3 (미리보기). 반영 전 거부 예상 목록
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_precheck_patches(_patches jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p jsonb; v_out jsonb := '[]'::jsonb; v_num text; v_code text; v_af date; v_id uuid;
        v_has_patch boolean; v_patch_af date;
BEGIN
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_patches,'[]'::jsonb)) LOOP
    v_num := p->>'wrt_number';
    SELECT i.id, coalesce(i.latest_response_code,'') INTO v_id, v_code
      FROM public.wrt_items i WHERE i.wrt_number = v_num;
    IF v_id IS NULL THEN CONTINUE; END IF;
    SELECT p2.actual_finish INTO v_af FROM public.wrt_stage_progress p2
      WHERE p2.item_id = v_id AND p2.stage_code = 'FINAL_SUBMISSION';
    v_has_patch := false; v_patch_af := NULL;
    SELECT true, nullif(s->>'actual_finish','')::date INTO v_has_patch, v_patch_af
      FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) s
     WHERE s->>'stage_code' = 'FINAL_SUBMISSION' AND s ? 'actual_finish' LIMIT 1;
    IF coalesce(v_has_patch,false) THEN v_af := v_patch_af; END IF;
    IF v_af IS NOT NULL AND upper(btrim(v_code)) <> 'A' THEN
      v_out := v_out || jsonb_build_object('key', v_num, 'reason_code', 'PRECONDITION_NOT_MET',
                                           'message', public.wrt_rule_msg(v_num, v_code));
    END IF;
  END LOOP;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.spl_precheck_patches(_patches jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p jsonb; v_out jsonb := '[]'::jsonb; v_num text; v_id uuid; v_af date;
        v_has_patch boolean; v_patch_af date; v_total int; v_ready int; v_missing text[];
BEGIN
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(_patches,'[]'::jsonb)) LOOP
    v_num := p->>'spl_number';
    SELECT i.id INTO v_id FROM public.spl_items i WHERE i.spl_number = v_num;
    IF v_id IS NULL THEN CONTINUE; END IF;
    SELECT p2.actual_finish INTO v_af FROM public.spl_stage_progress p2
      WHERE p2.item_id = v_id AND p2.stage_code = 'SUBMISSION';
    v_has_patch := false; v_patch_af := NULL;
    SELECT true, nullif(s->>'actual_finish','')::date INTO v_has_patch, v_patch_af
      FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) s
     WHERE s->>'stage_code' = 'SUBMISSION' AND s ? 'actual_finish' LIMIT 1;
    IF coalesce(v_has_patch,false) THEN v_af := v_patch_af; END IF;
    IF v_af IS NULL THEN CONTINUE; END IF;

    WITH merged AS (
      SELECT c.short_code, c.sort_order,
        coalesce((SELECT nullif(s->>'flag_value','') FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) s
                   WHERE s->>'stage_code' = c.stage_code AND s ? 'flag_value' LIMIT 1),
                 pr.flag_value) AS fv,
        coalesce((SELECT nullif(s->>'actual_start','')::date FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) s
                   WHERE s->>'stage_code' = c.stage_code AND s ? 'actual_start' LIMIT 1),
                 pr.actual_start) AS a_s
      FROM public.spl_stage_catalog c
      LEFT JOIN public.spl_stage_progress pr ON pr.item_id = v_id AND pr.stage_code = c.stage_code
      WHERE c.band = 'REQUIRED_DOC'
    )
    SELECT count(*)::int, count(*) FILTER (WHERE a_s IS NOT NULL)::int,
           coalesce(array_agg(short_code ORDER BY sort_order) FILTER (WHERE a_s IS NULL), '{}'::text[])
      INTO v_total, v_ready, v_missing
      FROM merged WHERE upper(btrim(coalesce(fv,''))) = 'REQUIRED';

    IF coalesce(v_total,0) > 0 AND v_ready < v_total THEN
      v_out := v_out || jsonb_build_object('key', v_num, 'reason_code', 'PRECONDITION_NOT_MET',
                                           'message', public.spl_rule_msg(v_num, v_ready, v_total, v_missing));
    END IF;
  END LOOP;
  RETURN v_out;
END $function$;

GRANT EXECUTE ON FUNCTION public.wrt_precheck_patches(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spl_precheck_patches(jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════
-- C-2 / C-3. hdec_apply — 행 단위 검사 · 행 단위 거부
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.wrt_items%ROWTYPE;
  v_auth text; v_code text;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_i0 int; v_s0 int; v_c0 int;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]) THEN
    RAISE EXCEPTION 'WRT import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.wrt_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'WRT import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('wrt.change_source', 'hdec_import', true);
  PERFORM set_config('wrt.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages; v_c0 := v_created;
    BEGIN
      SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';

      IF NOT FOUND THEN
        IF nullif(p->>'plot','') IS NULL THEN
          RAISE EXCEPTION 'WRT import: cannot create % without plot', p->>'wrt_number';
        END IF;
        INSERT INTO public.wrt_items(wrt_number, plot, team, pic, eng, created_by, updated_by)
        VALUES (p->>'wrt_number', p->>'plot',
          nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
          auth.uid(), auth.uid())
        ON CONFLICT (wrt_number) DO NOTHING;
        v_created := v_created + 1;
        SELECT * INTO it FROM public.wrt_items WHERE wrt_number = p->>'wrt_number';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'WRT import: failed to create %', p->>'wrt_number';
        END IF;
      ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        IF (p->'item') ?| ARRAY['r1_response_code','r2_response_code','latest_response_code','is_final_approved','dis','service','title','plot'] THEN
          RAISE EXCEPTION 'WRT authority violation: Aconex-owned item field in HDEC patch (wrt_number=%)', p->>'wrt_number';
        END IF;
        UPDATE public.wrt_items t SET
          team = CASE WHEN p->'item' ? 'team' THEN nullif(p->'item'->>'team','') ELSE t.team END,
          pic  = CASE WHEN p->'item' ? 'pic'  THEN nullif(p->'item'->>'pic','')  ELSE t.pic END,
          eng  = CASE WHEN p->'item' ? 'eng'  THEN nullif(p->'item'->>'eng','')  ELSE t.eng END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        SELECT actual_authority INTO v_auth FROM public.wrt_stage_catalog WHERE stage_code = v_code;
        IF v_auth IS NULL THEN
          RAISE EXCEPTION 'WRT import: unknown stage_code %', v_code;
        END IF;

        v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
        v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

        INSERT INTO public.wrt_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
        VALUES (it.id, v_code,
          CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
          CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
          CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
          CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
          CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE wrt_stage_progress.plan_start END,
          actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE wrt_stage_progress.actual_start END,
          plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE wrt_stage_progress.plan_finish END,
          actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE wrt_stage_progress.actual_finish END,
          flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE wrt_stage_progress.flag_value END,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      -- C-2: 행 반영 직후 검사
      PERFORM public.wrt_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0; v_created := v_c0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'wrt_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('wrt.change_source', 'app', true);
  PERFORM set_config('wrt.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created,
    'stages_upserted', v_stages, 'rejected', v_rejected, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$function$;

CREATE OR REPLACE FUNCTION public.spl_hdec_apply(_batch_id uuid, _patches jsonb, _allow_deletes boolean DEFAULT false, _delete_count integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p jsonb; s jsonb; it public.spl_items%ROWTYPE;
  v_auth text; v_type text; v_code text;
  v_items int := 0; v_stages int := 0; v_created int := 0;
  v_i0 int; v_s0 int; v_c0 int;
  v_pct numeric; v_min int; v_total int;
  v_write_as boolean; v_write_af boolean;
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['admin'::app_role,'superuser'::app_role,'d_superuser'::app_role]) THEN
    RAISE EXCEPTION 'SPL import: permission denied';
  END IF;

  IF _delete_count > 0 AND NOT _allow_deletes THEN
    SELECT (value->>'pct')::numeric, (value->>'min_count')::int
      INTO v_pct, v_min FROM public.spl_settings WHERE key = 'delete_guard';
    v_pct := coalesce(v_pct, 5); v_min := coalesce(v_min, 50);
    v_total := greatest(jsonb_array_length(_patches), 1);
    IF _delete_count >= v_min OR (_delete_count::numeric * 100 / v_total) >= v_pct THEN
      RAISE EXCEPTION 'SPL import halted: delete guard tripped (deletes=%, rows=%, threshold pct=%, min=%)',
        _delete_count, v_total, v_pct, v_min;
    END IF;
  END IF;

  PERFORM set_config('spl.change_source', 'hdec_import', true);
  PERFORM set_config('spl.batch_id', coalesce(_batch_id::text, ''), true);

  FOR p IN SELECT * FROM jsonb_array_elements(_patches) LOOP
    v_i0 := v_items; v_s0 := v_stages; v_c0 := v_created;
    BEGIN
      SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';

      IF NOT FOUND THEN
        IF nullif(p->>'plot','') IS NULL THEN
          RAISE EXCEPTION 'SPL import: cannot create % without plot', p->>'spl_number';
        END IF;
        INSERT INTO public.spl_items(spl_number, plot, team, pic, eng, pic_po, eng_po, supplier, created_by, updated_by)
        VALUES (p->>'spl_number', p->>'plot',
          nullif(p->'item'->>'team',''), nullif(p->'item'->>'pic',''), nullif(p->'item'->>'eng',''),
          nullif(p->'item'->>'pic_po',''), nullif(p->'item'->>'eng_po',''), nullif(p->'item'->>'supplier',''),
          auth.uid(), auth.uid())
        ON CONFLICT (spl_number) DO NOTHING;
        v_created := v_created + 1;
        SELECT * INTO it FROM public.spl_items WHERE spl_number = p->>'spl_number';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SPL import: failed to create %', p->>'spl_number';
        END IF;
      ELSIF p ? 'item' AND jsonb_typeof(p->'item') = 'object' AND (p->'item') <> '{}'::jsonb THEN
        UPDATE public.spl_items t SET
          team    = CASE WHEN p->'item' ? 'team'     THEN nullif(p->'item'->>'team','')     ELSE t.team END,
          pic     = CASE WHEN p->'item' ? 'pic'      THEN nullif(p->'item'->>'pic','')      ELSE t.pic END,
          eng     = CASE WHEN p->'item' ? 'eng'      THEN nullif(p->'item'->>'eng','')      ELSE t.eng END,
          pic_po  = CASE WHEN p->'item' ? 'pic_po'   THEN nullif(p->'item'->>'pic_po','')   ELSE t.pic_po END,
          eng_po  = CASE WHEN p->'item' ? 'eng_po'   THEN nullif(p->'item'->>'eng_po','')   ELSE t.eng_po END,
          supplier= CASE WHEN p->'item' ? 'supplier' THEN nullif(p->'item'->>'supplier','') ELSE t.supplier END,
          updated_by = auth.uid()
        WHERE t.id = it.id;
        v_items := v_items + 1;
      END IF;

      FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p->'stages','[]'::jsonb)) LOOP
        v_code := s->>'stage_code';
        SELECT actual_authority, value_type INTO v_auth, v_type
          FROM public.spl_stage_catalog WHERE stage_code = v_code;
        IF v_auth IS NULL THEN
          RAISE EXCEPTION 'SPL import: unknown stage_code %', v_code;
        END IF;

        v_write_as := (s ? 'actual_start')  AND (v_auth = 'HDEC' OR nullif(s->>'actual_start','')  IS NOT NULL);
        v_write_af := (s ? 'actual_finish') AND (v_auth = 'HDEC' OR nullif(s->>'actual_finish','') IS NOT NULL);

        INSERT INTO public.spl_stage_progress(item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value)
        VALUES (it.id, v_code,
          CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE NULL END,
          CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE NULL END,
          CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE NULL END,
          CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE NULL END,
          CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE NULL END)
        ON CONFLICT (item_id, stage_code) DO UPDATE SET
          plan_start    = CASE WHEN s ? 'plan_start'  THEN nullif(s->>'plan_start','')::date  ELSE spl_stage_progress.plan_start END,
          actual_start  = CASE WHEN v_write_as        THEN nullif(s->>'actual_start','')::date ELSE spl_stage_progress.actual_start END,
          plan_finish   = CASE WHEN s ? 'plan_finish' THEN nullif(s->>'plan_finish','')::date ELSE spl_stage_progress.plan_finish END,
          actual_finish = CASE WHEN v_write_af        THEN nullif(s->>'actual_finish','')::date ELSE spl_stage_progress.actual_finish END,
          flag_value    = CASE WHEN s ? 'flag_value'  THEN nullif(s->>'flag_value','')        ELSE spl_stage_progress.flag_value END,
          updated_by = auth.uid();
        v_stages := v_stages + 1;
      END LOOP;

      PERFORM public.spl_assert_row_rules(it.id);
    EXCEPTION WHEN OTHERS THEN
      v_items := v_i0; v_stages := v_s0; v_created := v_c0;
      v_rejected := v_rejected || jsonb_build_object(
        'key', p->>'spl_number',
        'reason_code', CASE WHEN SQLSTATE = '23514' THEN 'PRECONDITION_NOT_MET' ELSE 'ROW_ERROR' END,
        'message', SQLERRM);
    END;
  END LOOP;

  PERFORM set_config('spl.change_source', 'app', true);
  PERFORM set_config('spl.batch_id', '', true);

  RETURN jsonb_build_object('items_updated', v_items, 'items_created', v_created,
    'stages_upserted', v_stages, 'rejected', v_rejected, 'unmatched', to_jsonb(ARRAY[]::text[]));
END;
$function$;

-- ═══════════════════════════════════════════════════════════
-- rows_as_of — catalog 에 short_code 노출
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.wrt_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_catalog jsonb; v_rows jsonb; v_counts jsonb; v_bands jsonb;
  v_viol_total int; v_viol_new int; v_viol_prec int; v_viol_ghost int;
  v_viol_resp int; v_viol_imp int; v_pending int; v_pending_r1 int; v_pending_r2 int;
  v_pending_items int; v_inspected int; v_last_batch uuid;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'stage_code', stage_code, 'short_code', short_code, 'label', label, 'band', band,
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
    'active_round', ar.active_round,
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
  JOIN public.wrt_active_round(v_as_of) ar ON ar.item_id = i.id
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
$function$;

CREATE OR REPLACE FUNCTION public.spl_rows_as_of(_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
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
    'progress_pct', CASE WHEN e.denom = 0 THEN NULL
                         ELSE round(e.done::numeric * 100 / e.denom, 1) END,
    'judgment', e.judgment
  ) ORDER BY i.plot, i.spl_number)
  INTO v_rows
  FROM public.spl_items i
  JOIN public.spl_eval_as_of(v_as_of) e ON e.item_id = i.id
  JOIN public.spl_active_round(v_as_of) ar ON ar.item_id = i.id
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