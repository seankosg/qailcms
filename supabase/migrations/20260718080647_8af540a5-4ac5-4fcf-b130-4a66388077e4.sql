
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[],
  _bucket text, _range_start date, _range_end date,
  _as_of_date date, _plan_mode text, _round text
) RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service WHEN 'pic' THEN r.pic
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE WHEN UPPER(r.latest_status)='A' THEN
        CASE
          WHEN r.r3_dar_actual IS NOT NULL OR r.r3_dar_plan IS NOT NULL THEN 3
          WHEN r.r2_dar_actual IS NOT NULL OR r.r2_dar_plan IS NOT NULL THEN 2
          ELSE 1
        END
      END AS approved_round,
      r.r1_drafting_plan, r.r1_drafting_actual, r.r1_submission_plan, r.r1_submission_actual, r.r1_dar_plan, r.r1_dar_actual,
      r.r2_drafting_plan, r.r2_drafting_actual, r.r2_submission_plan, r.r2_submission_actual, r.r2_dar_plan, r.r2_dar_actual,
      r.r3_drafting_plan, r.r3_drafting_actual, r.r3_submission_plan, r.r3_submission_actual, r.r3_dar_plan, r.r3_dar_actual,
      r.approval_date
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate,
           (s.adate IS NOT NULL AND s.adate <= _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1, 'draft'::text,      b.r1_drafting_plan,   b.r1_drafting_actual),
      (1, 'submission',       b.r1_submission_plan, b.r1_submission_actual),
      (1, 'dar',              b.r1_dar_plan,        CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_dar_actual END),
      (2, 'draft',            b.r2_drafting_plan,   b.r2_drafting_actual),
      (2, 'submission',       b.r2_submission_plan, b.r2_submission_actual),
      (2, 'dar',              b.r2_dar_plan,        CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_dar_actual END),
      (3, 'draft',            b.r3_drafting_plan,   b.r3_drafting_actual),
      (3, 'submission',       b.r3_submission_plan, b.r3_submission_actual),
      (3, 'dar',              b.r3_dar_plan,        CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_dar_actual END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round = 'all' OR ('R' || s.round_num) = UPPER(_round)
  ),
  events AS (
    SELECT gk, CASE WHEN _bucket='week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso, stage, 1 AS p, 0 AS a
    FROM stage_expand
    WHERE pdate IS NOT NULL AND pdate BETWEEN _range_start AND _range_end
      AND (_plan_mode='baseline' OR NOT done_asof)
    UNION ALL
    SELECT gk, CASE WHEN _bucket='week' THEN date_trunc('week', adate)::date ELSE adate END, stage, 0, 1
    FROM stage_expand
    WHERE adate IS NOT NULL AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events GROUP BY 1,2,3
$function$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[],
  _as_of_date date, _plan_mode text, _round text
) RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service WHEN 'pic' THEN r.pic
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE WHEN UPPER(r.latest_status)='A' THEN
        CASE
          WHEN r.r3_dar_actual IS NOT NULL OR r.r3_dar_plan IS NOT NULL THEN 3
          WHEN r.r2_dar_actual IS NOT NULL OR r.r2_dar_plan IS NOT NULL THEN 2
          ELSE 1
        END
      END AS approved_round,
      r.r1_drafting_plan, r.r1_drafting_actual, r.r1_submission_plan, r.r1_submission_actual, r.r1_dar_plan, r.r1_dar_actual,
      r.r2_drafting_plan, r.r2_drafting_actual, r.r2_submission_plan, r.r2_submission_actual, r.r2_dar_plan, r.r2_dar_actual,
      r.r3_drafting_plan, r.r3_drafting_actual, r.r3_submission_plan, r.r3_submission_actual, r.r3_dar_plan, r.r3_dar_actual,
      r.approval_date
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate,
           (s.adate IS NOT NULL AND s.adate <= _as_of_date) AS done_asof
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1, 'draft'::text,      b.r1_drafting_plan,   b.r1_drafting_actual),
      (1, 'submission',       b.r1_submission_plan, b.r1_submission_actual),
      (1, 'dar',              b.r1_dar_plan,        CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_dar_actual END),
      (2, 'draft',            b.r2_drafting_plan,   b.r2_drafting_actual),
      (2, 'submission',       b.r2_submission_plan, b.r2_submission_actual),
      (2, 'dar',              b.r2_dar_plan,        CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_dar_actual END),
      (3, 'draft',            b.r3_drafting_plan,   b.r3_drafting_actual),
      (3, 'submission',       b.r3_submission_plan, b.r3_submission_actual),
      (3, 'dar',              b.r3_dar_plan,        CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_dar_actual END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round='all' OR ('R' || s.round_num) = UPPER(_round)
  )
  SELECT gk, stage,
    count(*)::int,
    count(*) FILTER (WHERE done_asof)::int,
    count(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND (_plan_mode='baseline' OR NOT done_asof))::int,
    count(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date AND done_asof)::int
  FROM stage_expand GROUP BY gk, stage
$function$;
