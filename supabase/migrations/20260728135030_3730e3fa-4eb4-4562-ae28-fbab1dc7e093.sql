CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals_json(
  _plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH b0 AS (
    SELECT
      r.team, r.room_group, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date  asd, r.actual_rectified_date  acd, r.actual_closure_date  axd,
      LOWER(TRIM(r.status_raw)) AS sr,
      COALESCE(CASE WHEN r.actual_progress_pct > 1 THEN r.actual_progress_pct ELSE r.actual_progress_pct * 100 END, 0) AS pnorm
    FROM public.defect_items_raw r
    WHERE r.is_active = true
      AND r.status_group = 'unclosed'
      AND (_plan_groups IS NULL OR cardinality(_plan_groups) = 0 OR r.plan_group = ANY(_plan_groups))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
      AND (
        _room_groups IS NULL OR cardinality(_room_groups) = 0
        OR COALESCE(NULLIF(TRIM(UPPER(r.room_group)), ''), 'N/A')
           = ANY(SELECT UPPER(x) FROM unnest(_room_groups) AS x)
      )
  ),
  base AS (
    SELECT
      (ARRAY[
        COALESCE(NULLIF(TRIM(CASE _group_by[1] WHEN 'team' THEN team WHEN 'room_group' THEN room_group WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[2] WHEN 'team' THEN team WHEN 'room_group' THEN room_group WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[3] WHEN 'team' THEN team WHEN 'room_group' THEN room_group WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[4] WHEN 'team' THEN team WHEN 'room_group' THEN room_group WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)')
      ])[1:cardinality(_group_by)] AS gk,
      psd, pcd, pxd, asd, acd, axd, sr, pnorm
    FROM b0
  ),
  flags AS (
    SELECT gk, psd, pcd, pxd, asd, acd, axd,
      (
        sr IN ('rectified','complete','completed','closed','verified')
        OR (asd IS NOT NULL AND asd <= _as_of_date)
        OR pnorm > 0
        OR (acd IS NOT NULL AND acd <= _as_of_date)
        OR (axd IS NOT NULL AND axd <= _as_of_date)
      ) AS s_done,
      (
        sr IN ('rectified','complete','completed','closed','verified')
        OR (acd IS NOT NULL AND acd <= _as_of_date)
        OR (axd IS NOT NULL AND axd <= _as_of_date)
        OR pnorm >= 100
      ) AS r_done,
      (
        sr IN ('closed','verified')
        OR (axd IS NOT NULL AND axd <= _as_of_date)
      ) AS c_done
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
  ),
  rows AS (
    SELECT gk AS group_key, 'start'::text AS stage, total, sdc AS done_upto, sp AS plan_upto, sdc AS actual_upto, snp AS no_plan FROM agg
    UNION ALL
    SELECT gk, 'rectified'::text, total, rdc, rp, rdc, rnp FROM agg
    UNION ALL
    SELECT gk, 'closure'::text, total, cdc, cp, cdc, cnp FROM agg
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) FROM rows
$function$;