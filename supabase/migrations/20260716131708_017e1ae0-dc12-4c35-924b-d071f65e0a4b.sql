CREATE OR REPLACE FUNCTION public.defect_snag_progress_cells(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text
) RETURNS TABLE(
  group_key text[],
  bucket_iso date,
  stage text,
  plan_cnt integer,
  actual_cnt integer
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
      r.planned_start_date       AS psd,
      r.planned_completion_date  AS pcd,
      r.planned_closure_date     AS pxd,
      r.actual_start_date        AS asd,
      r.actual_completion_date   AS acd,
      r.actual_closure_date      AS axd,
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
  stage_expand AS (
    SELECT gk, 'start'::text AS stage, psd AS pdate, asd AS adate,
      (asd IS NOT NULL AND asd <= _as_of_date
       AND (asd IS NOT NULL OR acd IS NOT NULL OR axd IS NOT NULL OR pnorm > 0)) AS done_asof
    FROM base
    UNION ALL
    SELECT gk, 'completion', pcd, acd,
      (acd IS NOT NULL AND acd <= _as_of_date
       AND (acd IS NOT NULL OR axd IS NOT NULL OR pnorm >= 100))
    FROM base
    UNION ALL
    SELECT gk, 'closure', pxd, axd,
      (axd IS NOT NULL AND axd <= _as_of_date)
    FROM base
  ),
  events AS (
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso,
      stage, 1 AS p, 0 AS a
    FROM stage_expand
    WHERE pdate IS NOT NULL AND pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode = 'baseline' OR NOT done_asof)
    UNION ALL
    SELECT gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', adate)::date ELSE adate END,
      stage, 0, 1
    FROM stage_expand
    WHERE adate IS NOT NULL AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events
  GROUP BY 1, 2, 3
$$;

CREATE OR REPLACE FUNCTION public.defect_snag_progress_totals(
  _plan_groups text[],
  _teams text[],
  _room_groups text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text
) RETURNS TABLE(
  group_key text[],
  stage text,
  total integer,
  done_upto integer,
  plan_upto integer,
  actual_upto integer
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
      r.planned_start_date       AS psd,
      r.planned_completion_date  AS pcd,
      r.planned_closure_date     AS pxd,
      r.actual_start_date        AS asd,
      r.actual_completion_date   AS acd,
      r.actual_closure_date      AS axd,
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
  stage_expand AS (
    SELECT gk, 'start'::text AS stage, psd AS pdate, asd AS adate,
      (asd IS NOT NULL AND asd <= _as_of_date
       AND (asd IS NOT NULL OR acd IS NOT NULL OR axd IS NOT NULL OR pnorm > 0)) AS done_asof
    FROM base
    UNION ALL
    SELECT gk, 'completion', pcd, acd,
      (acd IS NOT NULL AND acd <= _as_of_date
       AND (acd IS NOT NULL OR axd IS NOT NULL OR pnorm >= 100))
    FROM base
    UNION ALL
    SELECT gk, 'closure', pxd, axd,
      (axd IS NOT NULL AND axd <= _as_of_date)
    FROM base
  )
  SELECT
    gk, stage,
    count(*)::int AS total,
    count(*) FILTER (WHERE done_asof)::int AS done_upto,
    count(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND (_plan_mode = 'baseline' OR NOT done_asof))::int AS plan_upto,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int AS actual_upto
  FROM stage_expand
  GROUP BY gk, stage
$$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals(text[], text[], text[], text[], date, text) TO authenticated;
