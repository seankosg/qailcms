
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[], _bucket text,
  _range_start date, _range_end date, _as_of_date date,
  _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
          WHEN 'batch_no' THEN r.batch_no
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE
        WHEN r.r3_draft_start_plan IS NOT NULL OR r.r3_draft_start_actual IS NOT NULL
          OR r.r3_draft_finish_plan IS NOT NULL OR r.r3_draft_finish_actual IS NOT NULL
          OR r.r3_submission_plan IS NOT NULL OR r.r3_submission_actual IS NOT NULL
          OR r.r3_dar_plan IS NOT NULL OR r.r3_dar_actual IS NOT NULL THEN 3
        WHEN r.r2_draft_start_plan IS NOT NULL OR r.r2_draft_start_actual IS NOT NULL
          OR r.r2_draft_finish_plan IS NOT NULL OR r.r2_draft_finish_actual IS NOT NULL
          OR r.r2_submission_plan IS NOT NULL OR r.r2_submission_actual IS NOT NULL
          OR r.r2_dar_plan IS NOT NULL OR r.r2_dar_actual IS NOT NULL THEN 2
        ELSE 1
      END AS current_round,
      r.r1_draft_start_plan r1_ds_p, r.r1_draft_start_actual r1_ds_a,
      r.r1_draft_finish_plan r1_df_p, r.r1_draft_finish_actual r1_df_a,
      r.r1_submission_plan r1_sb_p, r.r1_submission_actual r1_sb_a,
      r.r1_dar_plan r1_rs_p, r.r1_dar_actual r1_rs_a,
      r.r2_draft_start_plan r2_ds_p, r.r2_draft_start_actual r2_ds_a,
      r.r2_draft_finish_plan r2_df_p, r.r2_draft_finish_actual r2_df_a,
      r.r2_submission_plan r2_sb_p, r.r2_submission_actual r2_sb_a,
      r.r2_dar_plan r2_rs_p, r.r2_dar_actual r2_rs_a,
      r.r3_draft_start_plan r3_ds_p, r.r3_draft_start_actual r3_ds_a,
      r.r3_draft_finish_plan r3_df_p, r.r3_draft_finish_actual r3_df_a,
      r.r3_submission_plan r3_sb_p, r.r3_submission_actual r3_sb_a,
      r.r3_dar_plan r3_rs_p, r.r3_dar_actual r3_rs_a
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND NOT COALESCE(r.is_terminated,false)
      AND (UPPER(COALESCE(r.latest_status,'')) <> 'A')
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  filtered AS (
    SELECT * FROM base
    WHERE _round = 'all' OR current_round = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate,
           (s.adate IS NOT NULL AND s.adate <= _as_of_date) AS done_asof
    FROM filtered b
    CROSS JOIN LATERAL (VALUES
      ('draft_start'::text,
        CASE b.current_round WHEN 1 THEN b.r1_ds_p WHEN 2 THEN b.r2_ds_p WHEN 3 THEN b.r3_ds_p END,
        CASE b.current_round WHEN 1 THEN b.r1_ds_a WHEN 2 THEN b.r2_ds_a WHEN 3 THEN b.r3_ds_a END),
      ('draft_finish',
        CASE b.current_round WHEN 1 THEN b.r1_df_p WHEN 2 THEN b.r2_df_p WHEN 3 THEN b.r3_df_p END,
        CASE b.current_round WHEN 1 THEN b.r1_df_a WHEN 2 THEN b.r2_df_a WHEN 3 THEN b.r3_df_a END),
      ('submission',
        CASE b.current_round WHEN 1 THEN b.r1_sb_p WHEN 2 THEN b.r2_sb_p WHEN 3 THEN b.r3_sb_p END,
        CASE b.current_round WHEN 1 THEN b.r1_sb_a WHEN 2 THEN b.r2_sb_a WHEN 3 THEN b.r3_sb_a END),
      ('dar',
        CASE b.current_round WHEN 1 THEN b.r1_rs_p WHEN 2 THEN b.r2_rs_p WHEN 3 THEN b.r3_rs_p END,
        CASE b.current_round WHEN 1 THEN b.r1_rs_a WHEN 2 THEN b.r2_rs_a WHEN 3 THEN b.r3_rs_a END)
    ) AS s(stage, pdate, adate)
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
$$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[],
  _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      ARRAY(
        SELECT COALESCE(NULLIF(TRIM(CASE dim
          WHEN 'team' THEN r.team WHEN 'plot' THEN r.plot WHEN 'dis' THEN r.dis
          WHEN 'service' THEN r.service
          WHEN 'hdec_pic_name' THEN r.hdec_pic_name
          WHEN 'hdec_eng_name' THEN r.hdec_eng_name
          WHEN 'doc_ax' THEN r.doc_ax WHEN 'doc_axx' THEN r.doc_axx
          WHEN 'batch_no' THEN r.batch_no
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      CASE
        WHEN r.r3_draft_start_plan IS NOT NULL OR r.r3_draft_start_actual IS NOT NULL
          OR r.r3_draft_finish_plan IS NOT NULL OR r.r3_draft_finish_actual IS NOT NULL
          OR r.r3_submission_plan IS NOT NULL OR r.r3_submission_actual IS NOT NULL
          OR r.r3_dar_plan IS NOT NULL OR r.r3_dar_actual IS NOT NULL THEN 3
        WHEN r.r2_draft_start_plan IS NOT NULL OR r.r2_draft_start_actual IS NOT NULL
          OR r.r2_draft_finish_plan IS NOT NULL OR r.r2_draft_finish_actual IS NOT NULL
          OR r.r2_submission_plan IS NOT NULL OR r.r2_submission_actual IS NOT NULL
          OR r.r2_dar_plan IS NOT NULL OR r.r2_dar_actual IS NOT NULL THEN 2
        ELSE 1
      END AS current_round,
      r.r1_draft_start_plan r1_ds_p, r.r1_draft_start_actual r1_ds_a,
      r.r1_draft_finish_plan r1_df_p, r.r1_draft_finish_actual r1_df_a,
      r.r1_submission_plan r1_sb_p, r.r1_submission_actual r1_sb_a,
      r.r1_dar_plan r1_rs_p, r.r1_dar_actual r1_rs_a,
      r.r2_draft_start_plan r2_ds_p, r.r2_draft_start_actual r2_ds_a,
      r.r2_draft_finish_plan r2_df_p, r.r2_draft_finish_actual r2_df_a,
      r.r2_submission_plan r2_sb_p, r.r2_submission_actual r2_sb_a,
      r.r2_dar_plan r2_rs_p, r.r2_dar_actual r2_rs_a,
      r.r3_draft_start_plan r3_ds_p, r.r3_draft_start_actual r3_ds_a,
      r.r3_draft_finish_plan r3_df_p, r.r3_draft_finish_actual r3_df_a,
      r.r3_submission_plan r3_sb_p, r.r3_submission_actual r3_sb_a,
      r.r3_dar_plan r3_rs_p, r.r3_dar_actual r3_rs_a
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND NOT COALESCE(r.is_terminated,false)
      AND (UPPER(COALESCE(r.latest_status,'')) <> 'A')
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  filtered AS (
    SELECT * FROM base
    WHERE _round = 'all' OR current_round = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
  ),
  stage_expand AS (
    SELECT gk, s.stage, s.pdate, s.adate
    FROM filtered b
    CROSS JOIN LATERAL (VALUES
      ('draft_start'::text,
        CASE b.current_round WHEN 1 THEN b.r1_ds_p WHEN 2 THEN b.r2_ds_p WHEN 3 THEN b.r3_ds_p END,
        CASE b.current_round WHEN 1 THEN b.r1_ds_a WHEN 2 THEN b.r2_ds_a WHEN 3 THEN b.r3_ds_a END),
      ('draft_finish',
        CASE b.current_round WHEN 1 THEN b.r1_df_p WHEN 2 THEN b.r2_df_p WHEN 3 THEN b.r3_df_p END,
        CASE b.current_round WHEN 1 THEN b.r1_df_a WHEN 2 THEN b.r2_df_a WHEN 3 THEN b.r3_df_a END),
      ('submission',
        CASE b.current_round WHEN 1 THEN b.r1_sb_p WHEN 2 THEN b.r2_sb_p WHEN 3 THEN b.r3_sb_p END,
        CASE b.current_round WHEN 1 THEN b.r1_sb_a WHEN 2 THEN b.r2_sb_a WHEN 3 THEN b.r3_sb_a END),
      ('dar',
        CASE b.current_round WHEN 1 THEN b.r1_rs_p WHEN 2 THEN b.r2_rs_p WHEN 3 THEN b.r3_rs_p END,
        CASE b.current_round WHEN 1 THEN b.r1_rs_a WHEN 2 THEN b.r2_rs_a WHEN 3 THEN b.r3_rs_a END)
    ) AS s(stage, pdate, adate)
  )
  SELECT gk, stage,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int AS done_upto,
         COUNT(*) FILTER (WHERE pdate IS NOT NULL AND pdate <= _as_of_date)::int AS plan_upto,
         COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int AS actual_upto
  FROM stage_expand
  GROUP BY 1, 2
$$;
