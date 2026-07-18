CREATE OR REPLACE FUNCTION public.abd_approved_round(_row public.abd_items_raw)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN UPPER(_row.latest_status) <> 'A' THEN NULL
    ELSE (
      SELECT COALESCE(MAX(n), 1)
      FROM (VALUES
        (1, _row.r1_dar_actual IS NOT NULL OR _row.r1_dar_plan IS NOT NULL),
        (2, _row.r2_dar_actual IS NOT NULL OR _row.r2_dar_plan IS NOT NULL),
        (3, _row.r3_dar_actual IS NOT NULL OR _row.r3_dar_plan IS NOT NULL)
      ) AS t(n, has_dar)
      WHERE has_dar
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.abd_round_stage_dates(_row public.abd_items_raw, _round integer, _stage text)
RETURNS TABLE(pdate date, adate date)
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT
    CASE _stage
      WHEN 'draft' THEN CASE _round
        WHEN 1 THEN _row.r1_drafting_plan
        WHEN 2 THEN _row.r2_drafting_plan
        WHEN 3 THEN _row.r3_drafting_plan
        ELSE NULL
      END
      WHEN 'submission' THEN CASE _round
        WHEN 1 THEN _row.r1_submission_plan
        WHEN 2 THEN _row.r2_submission_plan
        WHEN 3 THEN _row.r3_submission_plan
        ELSE NULL
      END
      WHEN 'dar' THEN CASE _round
        WHEN 1 THEN _row.r1_dar_plan
        WHEN 2 THEN _row.r2_dar_plan
        WHEN 3 THEN _row.r3_dar_plan
        ELSE NULL
      END
      ELSE NULL
    END AS pdate,
    CASE _stage
      WHEN 'draft' THEN CASE _round
        WHEN 1 THEN _row.r1_drafting_actual
        WHEN 2 THEN _row.r2_drafting_actual
        WHEN 3 THEN _row.r3_drafting_actual
        ELSE NULL
      END
      WHEN 'submission' THEN CASE _round
        WHEN 1 THEN _row.r1_submission_actual
        WHEN 2 THEN _row.r2_submission_actual
        WHEN 3 THEN _row.r3_submission_actual
        ELSE NULL
      END
      WHEN 'dar' THEN CASE _round
        WHEN 1 THEN CASE WHEN public.abd_approved_round(_row) = 1 THEN _row.approval_date ELSE _row.r1_dar_actual END
        WHEN 2 THEN CASE WHEN public.abd_approved_round(_row) = 2 THEN _row.approval_date ELSE _row.r2_dar_actual END
        WHEN 3 THEN CASE WHEN public.abd_approved_round(_row) = 3 THEN _row.approval_date ELSE _row.r3_dar_actual END
        ELSE NULL
      END
      ELSE NULL
    END AS adate
$$;

CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[],
  _teams text[],
  _group_by text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text,
  _round text
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'plot' THEN r.plot
          WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'pic' THEN r.pic
          WHEN 'doc_ax' THEN r.doc_ax
          WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  rounds AS (
    SELECT * FROM (VALUES (1), (2), (3)) AS t(n) WHERE _round = 'all' OR ('R' || t.n) = UPPER(_round)
  ),
  stage_expand AS (
    SELECT b.gk, rn.n AS round_num, st.stage,
           d.pdate, d.adate,
           (d.adate IS NOT NULL AND d.adate <= _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN rounds rn
    CROSS JOIN (VALUES ('draft'), ('submission'), ('dar')) AS st(stage)
    CROSS JOIN LATERAL public.abd_round_stage_dates(b.r, rn.n, st.stage) d
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

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[],
  _teams text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text,
  _round text
)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team
          WHEN 'plot' THEN r.plot
          WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'pic' THEN r.pic
          WHEN 'doc_ax' THEN r.doc_ax
          WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord)
        ORDER BY ord
      ) AS gk,
      r
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  rounds AS (
    SELECT * FROM (VALUES (1), (2), (3)) AS t(n) WHERE _round = 'all' OR ('R' || t.n) = UPPER(_round)
  ),
  stage_expand AS (
    SELECT b.gk, st.stage,
           d.pdate, d.adate,
           (d.adate IS NOT NULL AND d.adate <= _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN rounds rn
    CROSS JOIN (VALUES ('draft'), ('submission'), ('dar')) AS st(stage)
    CROSS JOIN LATERAL public.abd_round_stage_dates(b.r, rn.n, st.stage) d
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

GRANT EXECUTE ON FUNCTION public.abd_progress_cells(text[], text[], text[], text, date, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_progress_cells(text[], text[], text[], text, date, date, date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abd_progress_totals(text[], text[], text[], date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_progress_totals(text[], text[], text[], date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abd_approved_round(public.abd_items_raw) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_approved_round(public.abd_items_raw) TO service_role;
GRANT EXECUTE ON FUNCTION public.abd_round_stage_dates(public.abd_items_raw, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_round_stage_dates(public.abd_items_raw, integer, text) TO service_role;