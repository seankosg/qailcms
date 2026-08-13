CREATE OR REPLACE FUNCTION public.abd_progress_events(_as_of_date date, _plan_mode text DEFAULT 'baseline'::text, _round text DEFAULT 'all'::text)
 RETURNS TABLE(item_id uuid, stage text, field text, edate date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT (public.abd_judge_v1(r, _as_of_date)) AS judge, r.*
    FROM public.abd_items_raw r
    WHERE r.is_active = true
  ),
  expanded AS (
    SELECT b.id AS item_id,
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
  -- Actual = approval_date AND bucket_top='Approved'(현재 승인 유효분만).
  -- Plan = "현재 승인 전망": 미승인 → active_round 의 dar_plan,
  --        승인 → 승인 라운드(response_result='A')의 dar_plan 고정,
  --        레거시 승인(response_result 공백) → approval_date 가 속한 라운드,
  --        판별 불가 시 coalesce(r3→r2→r1) dar_plan.
  docs AS (
    SELECT b.id AS item_id,
           (b.judge->>'bucket_top') AS bucket_top,
           CASE WHEN (b.judge->>'bucket_top') = 'Approved'
                THEN b.approval_date ELSE NULL END AS ap_actual,
           CASE
             WHEN b.r1_response_result = 'A' THEN b.r1_dar_plan
             WHEN b.r2_response_result = 'A' THEN b.r2_dar_plan
             WHEN b.r3_response_result = 'A' THEN b.r3_dar_plan
             WHEN (b.judge->>'bucket_top') = 'Approved' THEN
               COALESCE(
                 CASE
                   WHEN b.approval_date IS NOT NULL AND b.r3_dar_actual = b.approval_date THEN b.r3_dar_plan
                   WHEN b.approval_date IS NOT NULL AND b.r2_dar_actual = b.approval_date THEN b.r2_dar_plan
                   WHEN b.approval_date IS NOT NULL AND b.r1_dar_actual = b.approval_date THEN b.r1_dar_plan
                 END,
                 b.r3_dar_plan, b.r2_dar_plan, b.r1_dar_plan
               )
             ELSE CASE (b.judge->>'active_round')::int
                    WHEN 1 THEN b.r1_dar_plan
                    WHEN 2 THEN b.r2_dar_plan
                    WHEN 3 THEN b.r3_dar_plan
                  END
           END AS ap_plan
    FROM base b
  )
  SELECT item_id, stage, 'planned'::text, pdate
  FROM expanded
  WHERE pdate IS NOT NULL
    AND (
      (_plan_mode = 'baseline' AND rn <= v_active)
      OR (_plan_mode <> 'baseline' AND rn = v_active
          AND bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date))
    )
  UNION ALL
  SELECT item_id, stage, 'actual'::text, adate
  FROM expanded
  WHERE adate IS NOT NULL
  UNION ALL
  SELECT item_id, 'approval'::text, 'planned'::text, ap_plan
  FROM docs
  WHERE ap_plan IS NOT NULL
    AND (_plan_mode = 'baseline' OR bucket_top <> 'Approved')
  UNION ALL
  SELECT item_id, 'approval'::text, 'actual'::text, ap_actual
  FROM docs
  WHERE ap_actual IS NOT NULL
$function$;