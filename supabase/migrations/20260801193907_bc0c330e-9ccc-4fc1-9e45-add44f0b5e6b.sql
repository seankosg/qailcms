-- 0. 카탈로그: 순차 사슬/판정 모집단 제외 표시 (stage_code 하드코딩 회피용 메타데이터)
ALTER TABLE public.spl_stage_catalog ADD COLUMN IF NOT EXISTS chain_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE public.wrt_stage_catalog ADD COLUMN IF NOT EXISTS chain_excluded boolean NOT NULL DEFAULT false;
UPDATE public.spl_stage_catalog SET chain_excluded = (band = 'REQUIRED_DOC');
UPDATE public.wrt_stage_catalog SET chain_excluded = false;

-- 1. 판정 함수 v2
CREATE OR REPLACE FUNCTION public.spl_judge_v2(
  _is_excluded boolean, _latest_status text, _denom integer, _has_primary_delay boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_is_excluded,false) THEN '제외'
    WHEN upper(btrim(coalesce(_latest_status,''))) = 'A' THEN '완료'
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_has_primary_delay,false) THEN '지연'
    ELSE '정상'
  END
$$;

CREATE OR REPLACE FUNCTION public.wrt_judge_v2(
  _is_excluded boolean, _is_final_approved boolean, _denom integer, _has_primary_delay boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(_is_excluded,false) THEN '제외'
    WHEN coalesce(_is_final_approved,false) THEN '완료'
    WHEN coalesce(_denom,0) = 0 THEN '미분류'
    WHEN coalesce(_has_primary_delay,false) THEN '지연'
    ELSE '정상'
  END
$$;

-- 2. SPL 아이템 평가 (읽기 시 재계산)
CREATE OR REPLACE FUNCTION public.spl_eval_as_of(_as_of date DEFAULT NULL)
RETURNS TABLE(
  item_id uuid, as_of date, stages jsonb,
  denom integer, done integer, delayed integer, na_count integer,
  req_doc_done integer, req_doc_total integer,
  active_band text, completed_stage jsonb, current_stage jsonb,
  primary_delay jsonb, delay_bucket jsonb, judgment text)
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
active AS (
  SELECT DISTINCT ON (item_id) item_id, band, bo FROM bandst WHERE bopen > 0 ORDER BY item_id, bo
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
  WHERE s.state = 'done' AND NOT s.chain_excluded
    AND (a.bo IS NULL OR s.sort_order < a.bo)
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
  a.band, c.completed_stage, cu.current_stage,
  pd.primary_delay, coalesce(b.delay_bucket,'[]'::jsonb),
  public.spl_judge_v2(i.is_excluded, i.latest_status, coalesce(g.denom,0), pd.primary_delay IS NOT NULL)
FROM public.spl_items i
LEFT JOIN agg g ON g.item_id = i.id
LEFT JOIN active a ON a.item_id = i.id
LEFT JOIN pd ON pd.item_id = i.id
LEFT JOIN bucket b ON b.item_id = i.id
LEFT JOIN comp c ON c.item_id = i.id
LEFT JOIN curr cu ON cu.item_id = i.id
WHERE i.is_active
$$;

-- 3. WRT 아이템 평가 (라운드 미발생 단계는 읽기 시 na 재판정)
CREATE OR REPLACE FUNCTION public.wrt_eval_as_of(_as_of date DEFAULT NULL)
RETURNS TABLE(
  item_id uuid, as_of date, stages jsonb,
  denom integer, done integer, delayed integer, na_count integer,
  active_band text, completed_stage jsonb, current_stage jsonb,
  primary_delay jsonb, delay_bucket jsonb, response_wait jsonb, judgment text)
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
         count(*) FILTER (WHERE state NOT IN ('na','none','done')) AS bopen
  FROM st WHERE NOT chain_excluded GROUP BY item_id, band
),
active AS (
  SELECT DISTINCT ON (item_id) item_id, band, bo FROM bandst WHERE bopen > 0 ORDER BY item_id, bo
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
  a.band, c.completed_stage, cu.current_stage,
  pd.primary_delay, coalesce(b.delay_bucket,'[]'::jsonb), coalesce(rw.response_wait,'[]'::jsonb),
  public.wrt_judge_v2(i.is_excluded, i.is_final_approved, coalesce(g.denom,0), pd.primary_delay IS NOT NULL)
FROM public.wrt_items i
LEFT JOIN agg g ON g.item_id = i.id
LEFT JOIN active a ON a.item_id = i.id
LEFT JOIN pd ON pd.item_id = i.id
LEFT JOIN bucket b ON b.item_id = i.id
LEFT JOIN respwait rw ON rw.item_id = i.id
LEFT JOIN comp c ON c.item_id = i.id
LEFT JOIN curr cu ON cu.item_id = i.id
WHERE i.is_active
$$;