
-- Rewrite defect_snag_progress_totals: single scan + unpivot to eliminate 3x UNION ALL
CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(
  _plan_groups text[], _teams text[], _room_groups text[],
  _group_by text[], _as_of_date date, _plan_mode text
) RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'subcontractor_name' THEN r.subcontractor_name
          WHEN 'subsub_name' THEN r.subsub_name
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'area_level' THEN r.area_level
          WHEN 'main_trade' THEN r.main_trade
          WHEN 'sub_trade' THEN r.sub_trade
          WHEN 'work_type' THEN r.work_type
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date  asd, r.actual_rectified_date  acd, r.actual_closure_date  axd,
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
  flags AS (
    SELECT gk, psd, pcd, pxd, asd, acd, axd,
      (asd IS NOT NULL AND asd <= _as_of_date
        AND (asd IS NOT NULL OR acd IS NOT NULL OR axd IS NOT NULL OR pnorm > 0)) AS s_done,
      (acd IS NOT NULL AND acd <= _as_of_date
        AND (acd IS NOT NULL OR axd IS NOT NULL OR pnorm >= 100)) AS r_done,
      (axd IS NOT NULL AND axd <= _as_of_date) AS c_done
    FROM base
  ),
  agg AS (
    SELECT gk,
      count(*)::int AS total,
      count(*) FILTER (WHERE s_done)::int AS s_done_cnt,
      count(*) FILTER (WHERE r_done)::int AS r_done_cnt,
      count(*) FILTER (WHERE c_done)::int AS c_done_cnt,
      count(*) FILTER (WHERE psd IS NOT NULL AND psd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT s_done))::int AS s_plan,
      count(*) FILTER (WHERE pcd IS NOT NULL AND pcd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT r_done))::int AS r_plan,
      count(*) FILTER (WHERE pxd IS NOT NULL AND pxd <= _as_of_date AND (_plan_mode = 'baseline' OR NOT c_done))::int AS c_plan,
      count(*) FILTER (WHERE asd IS NOT NULL AND asd <= _as_of_date AND s_done)::int AS s_act,
      count(*) FILTER (WHERE acd IS NOT NULL AND acd <= _as_of_date AND r_done)::int AS r_act,
      count(*) FILTER (WHERE axd IS NOT NULL AND axd <= _as_of_date AND c_done)::int AS c_act
    FROM flags
    GROUP BY gk
  )
  SELECT gk, 'start'::text,     total, s_done_cnt, s_plan, s_act FROM agg
  UNION ALL
  SELECT gk, 'rectified'::text, total, r_done_cnt, r_plan, r_act FROM agg
  UNION ALL
  SELECT gk, 'closure'::text,   total, c_done_cnt, c_plan, c_act FROM agg
$$;

-- Rewrite defect_snag_progress_cells: unpivot per-row into events without stage_expand UNION
CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[], _teams text[], _room_groups text[],
  _group_by text[], _bucket text, _range_start date, _range_end date,
  _as_of_date date, _plan_mode text
) RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'subcontractor_name' THEN r.subcontractor_name
          WHEN 'subsub_name' THEN r.subsub_name
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'area_level' THEN r.area_level
          WHEN 'main_trade' THEN r.main_trade
          WHEN 'sub_trade' THEN r.sub_trade
          WHEN 'work_type' THEN r.work_type
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r.planned_start_date psd, r.planned_rectified_date pcd, r.planned_closure_date pxd,
      r.actual_start_date  asd, r.actual_rectified_date  acd, r.actual_closure_date  axd,
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
  events AS (
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', v.d)::date ELSE v.d END AS bucket_iso,
      v.stage, v.p, v.a
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('start'::text, b.psd,
        1, 0,
        (b.asd IS NOT NULL AND b.asd <= _as_of_date)),
      ('start',       b.asd, 0, 1, false),
      ('rectified',   b.pcd, 1, 0,
        (b.acd IS NOT NULL AND b.acd <= _as_of_date) OR (b.axd IS NOT NULL AND b.axd <= _as_of_date) OR b.pnorm >= 100),
      ('rectified',   b.acd, 0, 1, false),
      ('closure',     b.pxd, 1, 0,
        (b.axd IS NOT NULL AND b.axd <= _as_of_date)),
      ('closure',     b.axd, 0, 1, false)
    ) AS v(stage, d, p, a, done_asof)
    WHERE v.d IS NOT NULL
      AND v.d BETWEEN _range_start AND _range_end
      AND (v.a = 1 OR _plan_mode = 'baseline' OR NOT v.done_asof)
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events
  GROUP BY 1, 2, 3
$$;
