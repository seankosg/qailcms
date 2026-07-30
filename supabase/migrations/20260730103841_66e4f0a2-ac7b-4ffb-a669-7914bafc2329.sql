-- 공용 done 판정 헬퍼 (단일 소스)
CREATE OR REPLACE FUNCTION public._snag_done_asof(
  _stage text, _sr text, _asd date, _acd date, _axd date, _pnorm numeric, _as_of date
) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  -- 날짜 근거 없는 현재 상태 스칼라(_sr, _pnorm)는 as-of 가 오늘 이상일 때만 사용.
  -- 과거 회고 조회에서는 그 시점 값을 복원할 수 없으므로 날짜 근거만 인정한다.
  SELECT CASE _stage
    WHEN 'start' THEN
      (_as_of >= (now() AT TIME ZONE 'Asia/Qatar')::date
        AND (_sr IN ('rectified','complete','completed','closed','verified') OR COALESCE(_pnorm,0) > 0))
      OR (_asd IS NOT NULL AND _asd <= _as_of)
      OR (_acd IS NOT NULL AND _acd <= _as_of)
      OR (_axd IS NOT NULL AND _axd <= _as_of)
    WHEN 'rectified' THEN
      (_as_of >= (now() AT TIME ZONE 'Asia/Qatar')::date
        AND (_sr IN ('rectified','complete','completed','closed','verified') OR COALESCE(_pnorm,0) >= 100))
      OR (_acd IS NOT NULL AND _acd <= _as_of)
      OR (_axd IS NOT NULL AND _axd <= _as_of)
    WHEN 'closure' THEN
      (_as_of >= (now() AT TIME ZONE 'Asia/Qatar')::date AND _sr IN ('closed','verified'))
      OR (_axd IS NOT NULL AND _axd <= _as_of)
    ELSE false
  END
$function$;

GRANT EXECUTE ON FUNCTION public._snag_done_asof(text,text,date,date,date,numeric,date) TO authenticated, service_role;

-- cells (행별)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  WITH b0 AS (
    SELECT r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date asd, r.actual_rectified_date acd, r.actual_closure_date axd,
      LOWER(TRIM(r.status_raw)) AS sr,
      public._snag_progress_norm(r.actual_progress_pct) AS pnorm
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
  ),
  base AS (
    SELECT (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk,
      psd, pcd, pxd, asd, acd, axd, sr, pnorm
    FROM b0
  ),
  events AS (
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', v.d)::date ELSE v.d END AS bucket_iso,
      v.stage, v.p, v.a
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text, b.psd, 1, 0, public._snag_done_asof('start', b.sr, b.asd, b.acd, b.axd, b.pnorm, _as_of_date)),
      ('start', b.asd, 0, 1, false),
      ('rectified', b.pcd, 1, 0, public._snag_done_asof('rectified', b.sr, b.asd, b.acd, b.axd, b.pnorm, _as_of_date)),
      ('rectified', b.acd, 0, 1, false),
      ('closure', b.pxd, 1, 0, public._snag_done_asof('closure', b.sr, b.asd, b.acd, b.axd, b.pnorm, _as_of_date)),
      ('closure', b.axd, 0, 1, false)
    ) AS v(stage, d, p, a, done_asof)
    WHERE v.d IS NOT NULL
      AND v.d BETWEEN _range_start AND _range_end
      AND (v.a = 1 OR _plan_mode = 'baseline' OR NOT v.done_asof)
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events GROUP BY 1, 2, 3
$function$;

-- cells (jsonb)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells_json(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _bucket text, _range_start date, _range_end date, _as_of_date date, _plan_mode text)
RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT group_key, bucket_iso, stage, plan_cnt, actual_cnt
    FROM public.defect_snag_progress_cells(_plan_groups, _teams, _room_groups, _group_by, _bucket, _range_start, _range_end, _as_of_date, _plan_mode)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg
$function$;

DROP FUNCTION IF EXISTS public.defect_snag_progress_totals(text[],text[],text[],text[],date,text);

-- totals (행별)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer, no_plan integer)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH b0 AS (
    SELECT r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date asd, r.actual_rectified_date acd, r.actual_closure_date axd,
      LOWER(TRIM(r.status_raw)) AS sr,
      public._snag_progress_norm(r.actual_progress_pct) AS pnorm
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (_room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A') = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x))
  ),
  base AS (
    SELECT (
      SELECT array_agg(COALESCE(NULLIF(TRIM(CASE u.g
        WHEN 'team' THEN b0.team WHEN 'room_group' THEN b0.room_group
        WHEN 'subcontractor_name' THEN b0.subcontractor_name WHEN 'subsub_name' THEN b0.subsub_name
        WHEN 'hdec_pic_name' THEN b0.hdec_pic_name WHEN 'hdec_eng_name' THEN b0.hdec_eng_name
        WHEN 'area_level' THEN b0.area_level WHEN 'main_trade' THEN b0.main_trade
        WHEN 'sub_trade' THEN b0.sub_trade WHEN 'work_type' THEN b0.work_type END), ''), '(None)') ORDER BY u.ord)
      FROM unnest(_group_by) WITH ORDINALITY AS u(g, ord)) AS gk,
      psd, pcd, pxd, asd, acd, axd, sr, pnorm
    FROM b0
  ),
  flags AS (
    SELECT gk, psd, pcd, pxd, asd, acd, axd,
      public._snag_done_asof('start', sr, asd, acd, axd, pnorm, _as_of_date) AS s_done,
      public._snag_done_asof('rectified', sr, asd, acd, axd, pnorm, _as_of_date) AS r_done,
      public._snag_done_asof('closure', sr, asd, acd, axd, pnorm, _as_of_date) AS c_done
    FROM base
  ),
  agg AS (
    SELECT gk,
      count(*)::int AS total,
      count(*) FILTER (WHERE s_done)::int AS sdc,
      count(*) FILTER (WHERE r_done)::int AS rdc,
      count(*) FILTER (WHERE c_done)::int AS cdc,
      count(*) FILTER (WHERE psd IS NOT NULL AND psd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT s_done))::int AS sp,
      count(*) FILTER (WHERE pcd IS NOT NULL AND pcd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT r_done))::int AS rp,
      count(*) FILTER (WHERE pxd IS NOT NULL AND pxd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT c_done))::int AS cp,
      count(*) FILTER (WHERE psd IS NULL AND asd IS NULL)::int AS snp,
      count(*) FILTER (WHERE pcd IS NULL AND acd IS NULL)::int AS rnp,
      count(*) FILTER (WHERE pxd IS NULL AND axd IS NULL)::int AS cnp
    FROM flags GROUP BY gk
  )
  SELECT gk, 'start'::text, total, sdc, sp, sdc, snp FROM agg
  UNION ALL
  SELECT gk, 'rectified'::text, total, rdc, rp, rdc, rnp FROM agg
  UNION ALL
  SELECT gk, 'closure'::text, total, cdc, cp, cdc, cnp FROM agg
$function$;

-- totals (jsonb)
CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals_json(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT group_key, stage, total, done_upto, plan_upto, actual_upto, no_plan
    FROM public.defect_snag_progress_totals(_plan_groups, _teams, _room_groups, _group_by, _as_of_date, _plan_mode)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) FROM rows
$function$;