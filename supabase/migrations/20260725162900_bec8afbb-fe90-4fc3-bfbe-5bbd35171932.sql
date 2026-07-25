
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[], _bucket text,
  _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
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
      COALESCE(r.r1_draft_start_plan,   CASE WHEN r.r1_draft_start_plan IS NULL AND r.r1_draft_finish_plan IS NULL THEN r.r1_drafting_plan END)   AS r1_ds_p,
      COALESCE(r.r1_draft_start_actual, CASE WHEN r.r1_draft_start_actual IS NULL AND r.r1_draft_finish_actual IS NULL THEN r.r1_drafting_actual END) AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sb_p, r.r1_submission_actual AS r1_sb_a,
      r.r1_dar_plan AS r1_rs_p, r.r1_dar_actual AS r1_rs_a,
      COALESCE(r.r2_draft_start_plan,   CASE WHEN r.r2_draft_start_plan IS NULL AND r.r2_draft_finish_plan IS NULL THEN r.r2_drafting_plan END)   AS r2_ds_p,
      COALESCE(r.r2_draft_start_actual, CASE WHEN r.r2_draft_start_actual IS NULL AND r.r2_draft_finish_actual IS NULL THEN r.r2_drafting_actual END) AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sb_p, r.r2_submission_actual AS r2_sb_a,
      r.r2_dar_plan AS r2_rs_p, r.r2_dar_actual AS r2_rs_a,
      COALESCE(r.r3_draft_start_plan,   CASE WHEN r.r3_draft_start_plan IS NULL AND r.r3_draft_finish_plan IS NULL THEN r.r3_drafting_plan END)   AS r3_ds_p,
      COALESCE(r.r3_draft_start_actual, CASE WHEN r.r3_draft_start_actual IS NULL AND r.r3_draft_finish_actual IS NULL THEN r.r3_drafting_actual END) AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sb_p, r.r3_submission_actual AS r3_sb_a,
      r.r3_dar_plan AS r3_rs_p, r.r3_dar_actual AS r3_rs_a,
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
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sb_p, b.r1_sb_a),
      (1, 'dar',               b.r1_rs_p, CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_rs_a END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sb_p, b.r2_sb_a),
      (2, 'dar',               b.r2_rs_p, CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_rs_a END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sb_p, b.r3_sb_a),
      (3, 'dar',               b.r3_rs_p, CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_rs_a END)
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
)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
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
      COALESCE(r.r1_draft_start_plan,   CASE WHEN r.r1_draft_start_plan IS NULL AND r.r1_draft_finish_plan IS NULL THEN r.r1_drafting_plan END)   AS r1_ds_p,
      COALESCE(r.r1_draft_start_actual, CASE WHEN r.r1_draft_start_actual IS NULL AND r.r1_draft_finish_actual IS NULL THEN r.r1_drafting_actual END) AS r1_ds_a,
      r.r1_draft_finish_plan AS r1_df_p, r.r1_draft_finish_actual AS r1_df_a,
      r.r1_submission_plan AS r1_sb_p, r.r1_submission_actual AS r1_sb_a,
      r.r1_dar_plan AS r1_rs_p, r.r1_dar_actual AS r1_rs_a,
      COALESCE(r.r2_draft_start_plan,   CASE WHEN r.r2_draft_start_plan IS NULL AND r.r2_draft_finish_plan IS NULL THEN r.r2_drafting_plan END)   AS r2_ds_p,
      COALESCE(r.r2_draft_start_actual, CASE WHEN r.r2_draft_start_actual IS NULL AND r.r2_draft_finish_actual IS NULL THEN r.r2_drafting_actual END) AS r2_ds_a,
      r.r2_draft_finish_plan AS r2_df_p, r.r2_draft_finish_actual AS r2_df_a,
      r.r2_submission_plan AS r2_sb_p, r.r2_submission_actual AS r2_sb_a,
      r.r2_dar_plan AS r2_rs_p, r.r2_dar_actual AS r2_rs_a,
      COALESCE(r.r3_draft_start_plan,   CASE WHEN r.r3_draft_start_plan IS NULL AND r.r3_draft_finish_plan IS NULL THEN r.r3_drafting_plan END)   AS r3_ds_p,
      COALESCE(r.r3_draft_start_actual, CASE WHEN r.r3_draft_start_actual IS NULL AND r.r3_draft_finish_actual IS NULL THEN r.r3_drafting_actual END) AS r3_ds_a,
      r.r3_draft_finish_plan AS r3_df_p, r.r3_draft_finish_actual AS r3_df_a,
      r.r3_submission_plan AS r3_sb_p, r.r3_submission_actual AS r3_sb_a,
      r.r3_dar_plan AS r3_rs_p, r.r3_dar_actual AS r3_rs_a,
      r.approval_date
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1, 'draft_start'::text, b.r1_ds_p, b.r1_ds_a),
      (1, 'draft_finish',      b.r1_df_p, b.r1_df_a),
      (1, 'submission',        b.r1_sb_p, b.r1_sb_a),
      (1, 'dar',               b.r1_rs_p, CASE WHEN b.approved_round=1 THEN b.approval_date ELSE b.r1_rs_a END),
      (2, 'draft_start',       b.r2_ds_p, b.r2_ds_a),
      (2, 'draft_finish',      b.r2_df_p, b.r2_df_a),
      (2, 'submission',        b.r2_sb_p, b.r2_sb_a),
      (2, 'dar',               b.r2_rs_p, CASE WHEN b.approved_round=2 THEN b.approval_date ELSE b.r2_rs_a END),
      (3, 'draft_start',       b.r3_ds_p, b.r3_ds_a),
      (3, 'draft_finish',      b.r3_df_p, b.r3_df_a),
      (3, 'submission',        b.r3_sb_p, b.r3_sb_a),
      (3, 'dar',               b.r3_rs_p, CASE WHEN b.approved_round=3 THEN b.approval_date ELSE b.r3_rs_a END)
    ) AS s(round_num, stage, pdate, adate)
    WHERE _round = 'all' OR ('R' || s.round_num) = UPPER(_round)
  )
  SELECT gk,
         stage,
         COUNT(*) FILTER (WHERE pdate IS NOT NULL OR adate IS NOT NULL)::int,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int,
         COUNT(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date)::int,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int
  FROM stage_expand
  GROUP BY 1, 2
$function$;
