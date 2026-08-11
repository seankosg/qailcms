CREATE OR REPLACE FUNCTION public.spl_eval_as_of(_as_of date DEFAULT NULL::date)
 RETURNS TABLE(item_id uuid, as_of date, stages jsonb, denom integer, done integer, delayed integer, na_count integer, req_doc_done integer, req_doc_total integer, active_band text, active_band_state text, hdec_actual_count integer, has_plan boolean, completed_stage jsonb, current_stage jsonb, primary_delay jsonb, delay_bucket jsonb, band_states jsonb, judgment text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
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
-- 2026-08-11: 지연 판정 범위를 HDEC 담당 단계 → 전 단계로 확대.
-- 계획일이 없는 단계는 spl_stage_state 에서 delayed 가 되지 않으므로 자동으로 판정 모수에서 제외된다.
pd AS (
  SELECT DISTINCT ON (s.item_id) s.item_id,
    jsonb_build_object('stage_code', s.stage_code, 'label', s.label, 'band', s.band,
      'days', GREATEST(0, ((SELECT d FROM params) - coalesce(s.plan_finish, s.plan_start))::int)) AS primary_delay
  FROM st s JOIN active a ON a.item_id = s.item_id AND a.band = s.band
  WHERE s.state = 'delayed' AND NOT s.chain_excluded
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