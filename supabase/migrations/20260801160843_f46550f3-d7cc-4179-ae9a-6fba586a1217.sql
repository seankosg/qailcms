DROP FUNCTION IF EXISTS public.defect_snag_progress_totals_json(text[],text[],text[],text[],date,text);
DROP FUNCTION IF EXISTS public.defect_snag_progress_totals(text[],text[],text[],text[],date,text);

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer, no_plan integer,
              np_sr integer, np_sc integer, np_rc integer, np_src integer)
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
      public._snag_done_asof('closure', sr, asd, acd, axd, pnorm, _as_of_date) AS c_done,
      (psd IS NULL AND asd IS NULL) AS s_np,
      (pcd IS NULL AND acd IS NULL) AS r_np,
      (pxd IS NULL AND axd IS NULL) AS c_np
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
      count(*) FILTER (WHERE s_np)::int AS snp,
      count(*) FILTER (WHERE r_np)::int AS rnp,
      count(*) FILTER (WHERE c_np)::int AS cnp,
      count(*) FILTER (WHERE s_np AND r_np)::int AS srnp,
      count(*) FILTER (WHERE s_np AND c_np)::int AS scnp,
      count(*) FILTER (WHERE r_np AND c_np)::int AS rcnp,
      count(*) FILTER (WHERE s_np AND r_np AND c_np)::int AS srcnp
    FROM flags GROUP BY gk
  )
  SELECT gk, 'start'::text, total, sdc, sp, sdc, snp, srnp, scnp, rcnp, srcnp FROM agg
  UNION ALL
  SELECT gk, 'rectified'::text, total, rdc, rp, rdc, rnp, srnp, scnp, rcnp, srcnp FROM agg
  UNION ALL
  SELECT gk, 'closure'::text, total, cdc, cp, cdc, cnp, srnp, scnp, rcnp, srcnp FROM agg
$function$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals_json(_plan_groups text[], _teams text[], _room_groups text[], _group_by text[], _as_of_date date, _plan_mode text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT group_key, stage, total, done_upto, plan_upto, actual_upto, no_plan, np_sr, np_sc, np_rc, np_src
    FROM public.defect_snag_progress_totals(_plan_groups, _teams, _room_groups, _group_by, _as_of_date, _plan_mode)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) FROM rows
$function$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals(text[],text[],text[],text[],date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals_json(text[],text[],text[],text[],date,text) TO authenticated, service_role;