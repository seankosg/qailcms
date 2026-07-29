-- AP Actual 재정의: approval_date AND stage_group='APPROVED' (현재 승인 유효분만)
-- 원본 approval_date 는 무수정. 재개봉(과거 승인 → 현재 B/C/UR)·Terminated 는 AP 곡선 제외,
-- 재승인 시 자연 재진입. 이로 인해 AP 누계는 재개봉 발생 시 감소할 수 있다(버그 아님, 재개봉 신호).
CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[], _bucket text,
  _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  -- _round 파라미터는 시그니처 호환을 위해 유지(항상 'all'로 호출). 변경 시 PGRST203 위험.
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
      (public.abd_judge_v1(r, _as_of_date)) AS judge,
      r.*
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  expanded AS (
    SELECT b.gk,
           (b.judge->>'active_round')::int AS v_active,
           (b.judge->>'bucket_top')        AS bucket_top,
           v.rn, v.stage, v.pdate, v.adate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1,'draft_start'::text,  b.r1_draft_start_plan,  b.r1_draft_start_actual),
      (1,'draft_finish',       b.r1_draft_finish_plan, b.r1_draft_finish_actual),
      (1,'submission',         b.r1_submission_plan,   b.r1_submission_actual),
      (1,'dar',                b.r1_dar_plan,          b.r1_dar_actual),
      (2,'draft_start',        b.r2_draft_start_plan,  b.r2_draft_start_actual),
      (2,'draft_finish',       b.r2_draft_finish_plan, b.r2_draft_finish_actual),
      (2,'submission',         b.r2_submission_plan,   b.r2_submission_actual),
      (2,'dar',                b.r2_dar_plan,          b.r2_dar_actual),
      (3,'draft_start',        b.r3_draft_start_plan,  b.r3_draft_start_actual),
      (3,'draft_finish',       b.r3_draft_finish_plan, b.r3_draft_finish_actual),
      (3,'submission',         b.r3_submission_plan,   b.r3_submission_actual),
      (3,'dar',                b.r3_dar_plan,          b.r3_dar_actual)
    ) AS v(rn, stage, pdate, adate)
    WHERE _round = 'all'
       OR v.rn = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
  ),
  -- AP(Approval): 문서 단위 종결 이벤트. 라운드 무관.
  -- Actual = approval_date AND bucket_top='Approved' (현재 승인 유효분만).
  -- Plan = "현재 승인 전망"(이동 예측형): 미승인 → 현재 라운드(v_active)의 dar_plan,
  --        승인 → 승인 라운드(response_result='A')의 dar_plan 고정, 레거시는 NULL.
  -- 주의: A-1(라운드 계획 소급 보존)과 성격이 다르다. 혼동 금지.
  docs AS (
    SELECT b.gk,
           (b.judge->>'active_round')::int AS v_active,
           (b.judge->>'bucket_top')        AS bucket_top,
           CASE WHEN (b.judge->>'bucket_top') = 'Approved'
                THEN b.approval_date ELSE NULL END AS ap_actual,
           CASE
             WHEN b.r1_response_result = 'A' THEN b.r1_dar_plan
             WHEN b.r2_response_result = 'A' THEN b.r2_dar_plan
             WHEN b.r3_response_result = 'A' THEN b.r3_dar_plan
             WHEN (b.judge->>'bucket_top') = 'Approved' THEN NULL
             ELSE CASE (b.judge->>'active_round')::int
                    WHEN 1 THEN b.r1_dar_plan
                    WHEN 2 THEN b.r2_dar_plan
                    WHEN 3 THEN b.r3_dar_plan
                  END
           END AS ap_plan
    FROM base b
  ),
  events AS (
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso,
           stage, 1 AS p, 0 AS a
    FROM expanded
    WHERE pdate IS NOT NULL
      AND pdate BETWEEN _range_start AND _range_end
      AND (
        (_plan_mode = 'baseline' AND rn <= v_active)
        OR (_plan_mode <> 'baseline' AND rn = v_active
            AND bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date))
      )
    UNION ALL
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', adate)::date ELSE adate END,
           stage, 0, 1
    FROM expanded
    WHERE adate IS NOT NULL
      AND adate BETWEEN _range_start AND _range_end
    UNION ALL
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', ap_plan)::date ELSE ap_plan END,
           'approval'::text, 1, 0
    FROM docs
    WHERE ap_plan IS NOT NULL
      AND ap_plan BETWEEN _range_start AND _range_end
      AND (_plan_mode = 'baseline' OR bucket_top <> 'Approved')
    UNION ALL
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', ap_actual)::date ELSE ap_actual END,
           'approval'::text, 0, 1
    FROM docs
    WHERE ap_actual IS NOT NULL
      AND ap_actual BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events GROUP BY 1,2,3
$function$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[], _as_of_date date, _plan_mode text, _round text)
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
          WHEN 'batch_no' THEN r.batch_no
        END), ''), '(None)')
        FROM unnest(_group_by) WITH ORDINALITY AS t(dim, ord) ORDER BY ord
      ) AS gk,
      (public.abd_judge_v1(r, _as_of_date)) AS judge,
      r.*
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      AND (_plots IS NULL OR cardinality(_plots) = 0 OR r.plot = ANY(_plots))
      AND (_teams IS NULL OR cardinality(_teams) = 0 OR r.team = ANY(_teams))
  ),
  expanded AS (
    SELECT b.gk,
           (b.judge->>'active_round')::int AS v_active,
           (b.judge->>'bucket_top')        AS bucket_top,
           v.rn, v.stage, v.pdate, v.adate
    FROM base b
    CROSS JOIN LATERAL (VALUES
      (1,'draft_start'::text,  b.r1_draft_start_plan,  b.r1_draft_start_actual),
      (1,'draft_finish',       b.r1_draft_finish_plan, b.r1_draft_finish_actual),
      (1,'submission',         b.r1_submission_plan,   b.r1_submission_actual),
      (1,'dar',                b.r1_dar_plan,          b.r1_dar_actual),
      (2,'draft_start',        b.r2_draft_start_plan,  b.r2_draft_start_actual),
      (2,'draft_finish',       b.r2_draft_finish_plan, b.r2_draft_finish_actual),
      (2,'submission',         b.r2_submission_plan,   b.r2_submission_actual),
      (2,'dar',                b.r2_dar_plan,          b.r2_dar_actual),
      (3,'draft_start',        b.r3_draft_start_plan,  b.r3_draft_start_actual),
      (3,'draft_finish',       b.r3_draft_finish_plan, b.r3_draft_finish_actual),
      (3,'submission',         b.r3_submission_plan,   b.r3_submission_actual),
      (3,'dar',                b.r3_dar_plan,          b.r3_dar_actual)
    ) AS v(rn, stage, pdate, adate)
    WHERE _round = 'all'
       OR v.rn = CASE _round WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END
  ),
  docs AS (
    SELECT b.gk,
           (b.judge->>'bucket_top') AS bucket_top,
           CASE WHEN (b.judge->>'bucket_top') = 'Approved'
                THEN b.approval_date ELSE NULL END AS ap_actual,
           CASE
             WHEN b.r1_response_result = 'A' THEN b.r1_dar_plan
             WHEN b.r2_response_result = 'A' THEN b.r2_dar_plan
             WHEN b.r3_response_result = 'A' THEN b.r3_dar_plan
             WHEN (b.judge->>'bucket_top') = 'Approved' THEN NULL
             ELSE CASE (b.judge->>'active_round')::int
                    WHEN 1 THEN b.r1_dar_plan
                    WHEN 2 THEN b.r2_dar_plan
                    WHEN 3 THEN b.r3_dar_plan
                  END
           END AS ap_plan
    FROM base b
  ),
  agg AS (
    SELECT gk, stage,
           COUNT(*) FILTER (WHERE rn = v_active)::int AS total,
           COUNT(*) FILTER (
             WHERE pdate IS NOT NULL AND pdate <= _as_of_date
               AND ((_plan_mode = 'baseline' AND rn <= v_active)
                    OR (_plan_mode <> 'baseline' AND rn = v_active
                        AND bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date)))
           )::int AS plan_upto,
           COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int AS actual_upto
    FROM expanded
    GROUP BY 1,2
  ),
  ap AS (
    SELECT gk, 'approval'::text AS stage,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE ap_plan IS NOT NULL AND ap_plan <= _as_of_date
               AND (_plan_mode = 'baseline' OR bucket_top <> 'Approved')
           )::int AS plan_upto,
           COUNT(*) FILTER (WHERE ap_actual IS NOT NULL AND ap_actual <= _as_of_date)::int AS actual_upto
    FROM docs
    GROUP BY 1
  )
  SELECT gk, stage, total, actual_upto AS done_upto, plan_upto, actual_upto FROM agg
  UNION ALL
  SELECT gk, stage, total, actual_upto AS done_upto, plan_upto, actual_upto FROM ap
$function$;