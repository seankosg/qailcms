CREATE OR REPLACE FUNCTION public.abd_judge_at_date(
  _ids uuid[],
  _as_of date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  active_round smallint,
  current_stage text,
  delay_bucket text[],
  ur_aging_days integer,
  bucket_top text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT r.*
    FROM public.abd_items_raw r
    WHERE r.id = ANY(_ids)
  ),
  active AS (
    SELECT
      s.id,
      CASE
        WHEN s.is_terminated THEN NULL::smallint
        WHEN upper(btrim(COALESCE(s.latest_status,''))) = 'A' THEN
          CASE
            WHEN s.r3_response_result = 'A' THEN 3::smallint
            WHEN s.r2_response_result = 'A' THEN 2::smallint
            ELSE 1::smallint
          END
        WHEN s.r2_response_result IS NOT NULL OR s.r3_draft_start_plan IS NOT NULL
             OR s.r3_draft_finish_plan IS NOT NULL OR s.r3_submission_plan IS NOT NULL
             OR s.r3_draft_start_actual IS NOT NULL OR s.r3_draft_finish_actual IS NOT NULL
             OR s.r3_submission_actual IS NOT NULL OR s.r3_dar_actual IS NOT NULL
          THEN 3::smallint
        WHEN s.r1_response_result IS NOT NULL OR s.r2_draft_start_plan IS NOT NULL
             OR s.r2_draft_finish_plan IS NOT NULL OR s.r2_submission_plan IS NOT NULL
             OR s.r2_draft_start_actual IS NOT NULL OR s.r2_draft_finish_actual IS NOT NULL
             OR s.r2_submission_actual IS NOT NULL OR s.r2_dar_actual IS NOT NULL
          THEN 2::smallint
        ELSE 1::smallint
      END AS act
    FROM src s
  ),
  stg AS (
    SELECT
      s.id, a.act,
      s.is_terminated,
      upper(btrim(COALESCE(s.latest_status,''))) AS ustatus,
      CASE a.act
        WHEN 1 THEN s.r1_draft_start_plan
        WHEN 2 THEN s.r2_draft_start_plan
        WHEN 3 THEN s.r3_draft_start_plan
      END AS ds_p,
      CASE a.act
        WHEN 1 THEN s.r1_draft_start_actual
        WHEN 2 THEN s.r2_draft_start_actual
        WHEN 3 THEN s.r3_draft_start_actual
      END AS ds_a,
      CASE a.act
        WHEN 1 THEN s.r1_draft_finish_plan
        WHEN 2 THEN s.r2_draft_finish_plan
        WHEN 3 THEN s.r3_draft_finish_plan
      END AS df_p,
      CASE a.act
        WHEN 1 THEN s.r1_draft_finish_actual
        WHEN 2 THEN s.r2_draft_finish_actual
        WHEN 3 THEN s.r3_draft_finish_actual
      END AS df_a,
      CASE a.act
        WHEN 1 THEN s.r1_submission_plan
        WHEN 2 THEN s.r2_submission_plan
        WHEN 3 THEN s.r3_submission_plan
      END AS sb_p,
      CASE a.act
        WHEN 1 THEN s.r1_submission_actual
        WHEN 2 THEN s.r2_submission_actual
        WHEN 3 THEN s.r3_submission_actual
      END AS sb_a,
      CASE a.act
        WHEN 1 THEN s.r1_dar_plan
        WHEN 2 THEN s.r2_dar_plan
        WHEN 3 THEN s.r3_dar_plan
      END AS rs_p,
      CASE a.act
        WHEN 1 THEN s.r1_dar_actual
        WHEN 2 THEN s.r2_dar_actual
        WHEN 3 THEN s.r3_dar_actual
      END AS rs_a
    FROM src s JOIN active a USING (id)
  )
  SELECT
    st.id,
    st.act,
    -- current_stage
    CASE
      WHEN st.is_terminated THEN 'Terminated'
      WHEN st.ustatus = 'A' THEN 'Approved'
      WHEN st.sb_a IS NOT NULL AND st.rs_a IS NULL THEN 'AwaitingResponse'
      WHEN st.df_a IS NOT NULL AND st.sb_a IS NULL THEN 'ReadyToSubmit'
      WHEN st.ds_a IS NOT NULL AND st.df_a IS NULL THEN 'Drafting'
      ELSE 'Pending'
    END::text,
    -- delay_bucket (as-of 기준 재계산)
    CASE
      WHEN st.is_terminated OR st.ustatus = 'A' THEN '{}'::text[]
      ELSE ARRAY_REMOVE(ARRAY[
        CASE WHEN st.ds_p IS NOT NULL AND st.ds_p < v_today AND st.ds_a IS NULL THEN 'DS' END,
        CASE WHEN st.df_p IS NOT NULL AND st.df_p < v_today AND st.df_a IS NULL AND st.ds_a IS NOT NULL THEN 'DF' END,
        CASE WHEN st.sb_p IS NOT NULL AND st.sb_p < v_today AND st.sb_a IS NULL AND st.df_a IS NOT NULL THEN 'SB' END,
        CASE WHEN st.rs_p IS NOT NULL AND st.rs_p < v_today AND st.rs_a IS NULL AND st.sb_a IS NOT NULL THEN 'RS' END
      ], NULL)
    END,
    -- ur_aging_days: 제출 후 응답 대기 일수
    CASE
      WHEN st.sb_a IS NOT NULL AND st.rs_a IS NULL AND v_today >= st.sb_a
        THEN (v_today - st.sb_a)::integer
      ELSE NULL
    END,
    -- bucket_top
    CASE
      WHEN st.is_terminated THEN 'Terminated'
      WHEN st.ustatus = 'A' THEN 'Approved'
      WHEN st.sb_a IS NOT NULL AND st.rs_a IS NULL THEN 'AwaitingResponse'
      WHEN st.df_a IS NOT NULL AND st.sb_a IS NULL THEN 'ReadyToSubmit'
      WHEN st.ds_a IS NOT NULL AND st.df_a IS NULL THEN 'Drafting'
      ELSE 'Pending'
    END::text
  FROM stg st;
END;
$$;

GRANT EXECUTE ON FUNCTION public.abd_judge_at_date(uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_judge_at_date(uuid[], date) TO service_role;