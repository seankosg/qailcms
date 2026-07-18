CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[], _teams text[], _room_groups text[],
  _group_by text[], _bucket text, _range_start date, _range_end date,
  _as_of_date date, _plan_mode text
) RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  WITH b0 AS (
    SELECT
      r.team, r.subcontractor_name, r.subsub_name, r.hdec_pic_name, r.hdec_eng_name,
      r.area_level, r.main_trade, r.sub_trade, r.work_type,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date asd, r.actual_rectified_date acd, r.actual_closure_date axd,
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
        COALESCE(NULLIF(TRIM(CASE _group_by[1] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[2] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[3] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[4] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[5] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[6] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[7] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[8] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)'),
        COALESCE(NULLIF(TRIM(CASE _group_by[9] WHEN 'team' THEN team WHEN 'subcontractor_name' THEN subcontractor_name WHEN 'subsub_name' THEN subsub_name WHEN 'hdec_pic_name' THEN hdec_pic_name WHEN 'hdec_eng_name' THEN hdec_eng_name WHEN 'area_level' THEN area_level WHEN 'main_trade' THEN main_trade WHEN 'sub_trade' THEN sub_trade WHEN 'work_type' THEN work_type END), ''), '(None)')
      ])[1:cardinality(_group_by)] AS gk,
      psd, pcd, pxd, asd, acd, axd, pnorm
    FROM b0
  ),
  events AS (
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', v.d)::date ELSE v.d END AS bucket_iso,
      v.stage, v.p, v.a
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text, b.psd, 1, 0, (b.asd IS NOT NULL AND b.asd <= _as_of_date)),
      ('start', b.asd, 0, 1, false),
      ('rectified', b.pcd, 1, 0, (b.acd IS NOT NULL AND b.acd <= _as_of_date) OR (b.axd IS NOT NULL AND b.axd <= _as_of_date) OR b.pnorm >= 100),
      ('rectified', b.acd, 0, 1, false),
      ('closure', b.pxd, 1, 0, (b.axd IS NOT NULL AND b.axd <= _as_of_date)),
      ('closure', b.axd, 0, 1, false)
    ) AS v(stage, d, p, a, done_asof)
    WHERE v.d IS NOT NULL
      AND v.d BETWEEN _range_start AND _range_end
      AND (v.a = 1 OR _plan_mode = 'baseline' OR NOT v.done_asof)
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events
  GROUP BY 1, 2, 3
$$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text) TO service_role;