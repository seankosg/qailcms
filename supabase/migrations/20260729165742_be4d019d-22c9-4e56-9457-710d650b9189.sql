-- ============================================================================
-- ABD Progress Matrix 집계 정합화 (2026-07-29)
--
-- [라운드 생애주기 확정 정의]
--   개시: r{n}_draft_start_actual
--   진행: r{n}_draft_finish_actual -> r{n}_submission_actual (제출 후 심사대기 = UR(n))
--   종결: r{n}_dar_actual + r{n}_response_result 기록 시점 (회신 도착 = 라운드 종결)
--         A -> 문서 종결 / B·C -> 라운드만 종결, 다음 라운드 개시 / 회신 전 -> 라운드 열림
--   예외 Terminated: 회신 없는 합의 철회. 라운드 종결이 아니며 같은 라운드 재제출.
--         실적 필드 보존, 통계 포함(Progress 는 excluded=all).
--
-- [실적 vs 잔여 기준 분리]
--   * 실적(actual) 집계: r{n}_*_actual 은 "영구히 라운드 n 의 사건"이다.
--     active_round / approved_round / *_plan 을 실적 경로에서 완전 배제한다.
--     _round 파라미터는 "어느 컬럼을 볼 것인가"이며 all = R1/R2/R3 컬럼 UNION.
--   * 잔여/예정(plan, remaining): "지금 남은 일"이므로 현재 라운드 기준이며
--     반드시 정본 public.abd_judge_v1(row, as_of)->>'active_round' 경유(자체 계산 금지).
--
--   ※ 상호 참조: abd_judge_v1 의 v_active 는 "지금 어느 라운드 진행 중"을 답하는 별개 용도로
--     실적 귀속에 혼용 금지. 임포트측 abd/aconex-import.functions.ts 의 resolveActiveRound
--     와도 의도적으로 규칙이 다르다(해당 파일 주석 참조).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.abd_progress_cells(
  _plots text[], _teams text[], _group_by text[], _bucket text,
  _range_start date, _range_end date, _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], bucket_iso date, stage text, plan_cnt integer, actual_cnt integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
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
      -- 잔여(plan) 경로 전용. 실적 경로에서는 사용하지 않는다.
      (public.abd_judge_v1(r, _as_of_date)) AS judge,
      r.*
    FROM public.abd_items_raw r
    WHERE r.is_active = true
      -- is_terminated / latest_status='A' 제외 없음: 실적 이벤트 소급 삭제 금지
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
  events AS (
    -- 계획: 현재 라운드(정본 판정) 한정
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', pdate)::date ELSE pdate END AS bucket_iso,
           stage, 1 AS p, 0 AS a
    FROM expanded
    WHERE pdate IS NOT NULL
      AND pdate BETWEEN _range_start AND _range_end
      AND rn = v_active
      AND (
        _plan_mode = 'baseline'
        OR (bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date))
      )
    UNION ALL
    -- 실적: 컬럼이 라운드를 결정. 현재 라운드로 슬라이스하지 않는다.
    SELECT gk,
           CASE WHEN _bucket='week' THEN date_trunc('week', adate)::date ELSE adate END,
           stage, 0, 1
    FROM expanded
    WHERE adate IS NOT NULL
      AND adate BETWEEN _range_start AND _range_end
  )
  SELECT gk, bucket_iso, stage, sum(p)::int, sum(a)::int
  FROM events GROUP BY 1,2,3
$function$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals(
  _plots text[], _teams text[], _group_by text[],
  _as_of_date date, _plan_mode text, _round text
)
RETURNS TABLE(group_key text[], stage text, total integer, done_upto integer, plan_upto integer, actual_upto integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
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
  agg AS (
    -- total: 잔여 산정 분모이므로 현재 라운드(정본 판정) 기준 문서 수
    SELECT gk, stage,
           COUNT(*) FILTER (WHERE rn = v_active)::int AS total,
           COUNT(*) FILTER (
             WHERE pdate IS NOT NULL AND pdate <= _as_of_date AND rn = v_active
               AND (_plan_mode = 'baseline'
                    OR (bucket_top <> 'Approved' AND (adate IS NULL OR adate > _as_of_date)))
           )::int AS plan_upto,
           -- 실적 누계: 라운드 컬럼 기준, 승인·철회 무관 보존
           COUNT(*) FILTER (WHERE adate IS NOT NULL AND adate <= _as_of_date)::int AS actual_upto
    FROM expanded
    GROUP BY 1,2
  )
  SELECT gk, stage, total, actual_upto AS done_upto, plan_upto, actual_upto
  FROM agg
$function$;

COMMENT ON FUNCTION public.abd_progress_cells(text[],text[],text[],text,date,date,date,text,text) IS
'ABD Progress 셀 집계. 실적은 r{n}_*_actual 컬럼이 라운드를 영구 결정(active_round 배제), 계획/잔여만 정본 abd_judge_v1 의 active_round 기준. is_terminated / latest_status=A 항목도 실적 집계 포함.';

COMMENT ON FUNCTION public.abd_progress_totals(text[],text[],text[],date,text,text) IS
'ABD Progress 합계. actual_upto/done_upto 는 라운드 컬럼 기준 실적 누계(소급 삭제 없음), total/plan_upto 는 정본 abd_judge_v1 active_round 기준 잔여 산정용.';