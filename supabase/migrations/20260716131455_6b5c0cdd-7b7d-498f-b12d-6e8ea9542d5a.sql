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
      r AS row,
      ARRAY(
        SELECT public._snag_group_val(r, dim)
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk
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
  stage_rows AS (
    SELECT
      b.gk,
      s.stage,
      public._snag_stage_planned_date(b.row, s.stage) AS pdate,
      public._snag_stage_actual_date(b.row, s.stage)  AS adate,
      (
        public._snag_stage_actual_date(b.row, s.stage) IS NOT NULL
        AND public._snag_stage_actual_date(b.row, s.stage) <= _as_of_date
        AND public._snag_stage_done(b.row, s.stage)
      ) AS done_asof
    FROM base b
    CROSS JOIN LATERAL unnest(ARRAY['start','completion','closure']) AS s(stage)
  ),
  events AS (
    SELECT
      gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso,
      stage,
      1 AS p, 0 AS a
    FROM stage_rows
    WHERE pdate IS NOT NULL AND pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode = 'baseline' OR NOT done_asof)
    UNION ALL
    SELECT
      gk,
      CASE WHEN _bucket = 'week' THEN date_trunc('week', adate)::date ELSE adate END,
      stage,
      0, 1
    FROM stage_rows
    WHERE adate IS NOT NULL AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk AS group_key, bucket_iso, stage, sum(p)::int AS plan_cnt, sum(a)::int AS actual_cnt
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
      r AS row,
      ARRAY(
        SELECT public._snag_group_val(r, dim)
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk
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
  stage_rows AS (
    SELECT
      b.gk,
      s.stage,
      public._snag_stage_planned_date(b.row, s.stage) AS pdate,
      public._snag_stage_actual_date(b.row, s.stage)  AS adate,
      (
        public._snag_stage_actual_date(b.row, s.stage) IS NOT NULL
        AND public._snag_stage_actual_date(b.row, s.stage) <= _as_of_date
        AND public._snag_stage_done(b.row, s.stage)
      ) AS done_asof
    FROM base b
    CROSS JOIN LATERAL unnest(ARRAY['start','completion','closure']) AS s(stage)
  )
  SELECT
    gk AS group_key,
    stage,
    count(*)::int AS total,
    count(*) FILTER (WHERE done_asof)::int AS done_upto,
    count(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND (_plan_mode = 'baseline' OR NOT done_asof))::int AS plan_upto,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int AS actual_upto
  FROM stage_rows
  GROUP BY gk, stage
$$;

GRANT EXECUTE ON FUNCTION public.defect_snag_progress_cells(text[], text[], text[], text[], text, date, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defect_snag_progress_totals(text[], text[], text[], text[], date, text) TO authenticated;
