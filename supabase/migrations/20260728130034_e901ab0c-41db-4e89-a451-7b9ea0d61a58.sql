
-- =========================================================================
-- 1) 단일 정본 판정 함수 tm_kpi_judgment
--    - Raw 필드만 사용. stored auto_judgment 참조 금지 (순환 제거).
--    - is_completed := (actual_progress >= 1) OR (actual_finish IS NOT NULL)
--      근거: kpi-utils.ts:36-38 원 로직에서 stored auto_judgment='완료' 조건 제거.
--            derived.ts:210 (actual>=1) 및 derived.ts:263-266 (isFinishedLate가
--            actual_finish 존재를 완료 강한 시그널로 취급) 참고.
--    - 미래시작 미착수(plan_start > as_of, not started, not completed) → '정상'
--    - gap = tm_kpi_gap(...) 단일 소스
-- =========================================================================
DROP FUNCTION IF EXISTS public.tm_kpi_judgment(numeric, date, date, date, date, integer, numeric, date, numeric, numeric);

CREATE OR REPLACE FUNCTION public.tm_kpi_judgment(
  _actual_progress   numeric,
  _actual_finish     date,
  _actual_start      date,
  _plan_start        date,
  _plan_end          date,
  _plan_days         integer,
  _plan_progress     numeric,
  _as_of             date,
  _caution_buffer    numeric,
  _worsen_gap        numeric
) RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH d AS (
    SELECT
      -- is_completed: raw only (NO auto_judgment)
      (COALESCE(_actual_progress, 0) >= 1 OR _actual_finish IS NOT NULL) AS is_completed,
      (_actual_start IS NOT NULL OR COALESCE(_actual_progress, 0) > 0)   AS is_started,
      (_plan_start IS NOT NULL AND _as_of IS NOT NULL
        AND _plan_start > _as_of)                                        AS is_future_start,
      public.tm_kpi_gap(_actual_progress, _plan_progress, _plan_start, _plan_end, _plan_days, _as_of) AS gap
  )
  SELECT CASE
    WHEN d.is_completed THEN '완료'
    -- 미래시작 미착수 예외: 시작일 도래 전 & 미착수 → 무조건 정상
    WHEN d.is_future_start AND NOT d.is_started THEN '정상'
    WHEN d.gap IS NULL THEN '정상'
    WHEN d.gap < COALESCE(_worsen_gap, -0.15)   THEN '악화'
    WHEN d.gap < 0                              THEN '지연'
    WHEN d.gap < COALESCE(_caution_buffer, 0.05) THEN '주의'
    ELSE '정상'
  END
  FROM d;
$$;

GRANT EXECUTE ON FUNCTION public.tm_kpi_judgment(numeric, date, date, date, date, integer, numeric, date, numeric, numeric)
  TO authenticated, service_role, anon;

-- =========================================================================
-- 2) tm_kpi_bucket_matches 재작성: raw 기반 완료 판정 (actual_finish 추가, auto_judgment 제거)
--    - 기존 12 버킷 시맨틱 유지(kpi-utils.ts:118-162와 정합).
--    - 통일 함수 tm_kpi_judgment 와 동일한 is_completed / gap 계산.
-- =========================================================================
DROP FUNCTION IF EXISTS public.tm_kpi_bucket_matches(text, numeric, date, date, date, integer, numeric, text, date, numeric);
DROP FUNCTION IF EXISTS public.tm_kpi_bucket_matches(text, numeric, date, date, date, date, integer, numeric, date, numeric, numeric);

CREATE OR REPLACE FUNCTION public.tm_kpi_bucket_matches(
  _bucket            text,
  _actual_progress   numeric,
  _actual_finish     date,
  _actual_start      date,
  _plan_start        date,
  _plan_end          date,
  _plan_days         integer,
  _plan_progress     numeric,
  _as_of             date,
  _caution_buffer    numeric,
  _worsen_gap        numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH d AS (
    SELECT
      (COALESCE(_actual_progress, 0) >= 1 OR _actual_finish IS NOT NULL) AS is_completed,
      (_actual_start IS NOT NULL)                                        AS is_started,
      (_plan_start IS NOT NULL AND _as_of IS NOT NULL
        AND _plan_start <= _as_of)                                       AS is_planned_started,
      (_plan_end IS NOT NULL AND _as_of IS NOT NULL
        AND _plan_end < _as_of)                                          AS is_plan_end_past,
      (_plan_start IS NOT NULL AND _as_of IS NOT NULL
        AND _plan_start > _as_of)                                        AS is_future_start,
      public.tm_kpi_gap(_actual_progress, _plan_progress, _plan_start, _plan_end, _plan_days, _as_of) AS gap,
      public.tm_kpi_judgment(_actual_progress, _actual_finish, _actual_start,
                              _plan_start, _plan_end, _plan_days, _plan_progress,
                              _as_of, _caution_buffer, _worsen_gap) AS judgment
  )
  SELECT CASE _bucket
    WHEN 'completed'          THEN d.is_completed
    WHEN 'wip'                THEN d.is_started AND NOT d.is_completed
    WHEN 'not_started'        THEN NOT d.is_started AND NOT d.is_completed
    WHEN 'planned_started'    THEN d.is_planned_started
    WHEN 'actual_started'     THEN d.is_started
    -- In Delay / Behind: 미완료 & gap<0, 단 미래시작 미착수는 gap 계산상 이미 정상이 되어 제외됨.
    WHEN 'in_delay'           THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
    WHEN 'behind'             THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
    WHEN 'start_delayed'      THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
                                   AND d.is_planned_started AND NOT d.is_started
    WHEN 'completion_overdue' THEN NOT d.is_completed AND d.judgment IN ('지연','악화')
                                   AND d.is_plan_end_past
    WHEN 'critical'           THEN NOT d.is_completed AND d.judgment = '악화'
    WHEN 'no_plan_start'      THEN _plan_start IS NULL
    WHEN 'no_plan_end'        THEN _plan_end IS NULL
    -- 신설: 판정 라벨 축 (드릴다운 뱃지 매핑용, 옵션)
    WHEN 'j_caution'          THEN d.judgment = '주의'
    WHEN 'j_normal'           THEN d.judgment = '정상'
    ELSE FALSE
  END
  FROM d;
$$;

GRANT EXECUTE ON FUNCTION public.tm_kpi_bucket_matches(text, numeric, date, date, date, date, integer, numeric, date, numeric, numeric)
  TO authenticated, service_role, anon;

-- =========================================================================
-- 3) tm_items_counts — KPI 카드 12 버킷 카운트 (jsonb 스칼라 반환)
--    - 필터/검색은 tm_items_search_ids 와 동일 규약 재사용.
--    - task_scope: 'all' | 'main' | 'sub' (kpi-utils.ts:28-34)
--    - as_of / thresholds 세션 값 서버 전달 필수.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tm_items_counts(
  _q                 text     DEFAULT NULL,
  _filters           jsonb    DEFAULT '[]'::jsonb,
  _include_inactive  boolean  DEFAULT FALSE,
  _task_scope        text     DEFAULT 'all',
  _as_of             date     DEFAULT NULL,
  _caution_buffer    numeric  DEFAULT 0.05,
  _worsen_gap        numeric  DEFAULT -0.15
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_asof date := COALESCE(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  r jsonb;
BEGIN
  -- 1) 필터/검색 후보 ID 확보 (tm_items_search_ids 재사용)
  SELECT ARRAY(
    SELECT (elem::text)::uuid
    FROM jsonb_array_elements_text(
      COALESCE(
        (SELECT public.tm_items_search_ids(_q, _filters, _include_inactive, 200000, NULL, NULL, NULL)),
        '[]'::jsonb
      )
    ) elem
  ) INTO v_ids;

  -- 2) 스코프 필터 + 각 버킷 카운트 집계 (단일 스캔)
  WITH scoped AS (
    SELECT t.*
    FROM public.v_task_management_raw_derived t
    WHERE t.id = ANY(v_ids)
      AND (
        _task_scope = 'all'
        OR (_task_scope = 'main' AND LOWER(COALESCE(t.level::text,'')) = 'main')
        OR (_task_scope = 'sub'  AND LOWER(COALESCE(t.level::text,'')) = 'sub')
      )
  ),
  judged AS (
    SELECT
      s.id,
      (COALESCE(s.actual_progress,0) >= 1 OR s.actual_finish IS NOT NULL) AS is_completed,
      (s.actual_start IS NOT NULL)                                        AS is_started,
      (s.plan_start IS NOT NULL AND s.plan_start <= v_asof)               AS is_planned_started,
      (s.plan_end   IS NOT NULL AND s.plan_end   <  v_asof)               AS is_plan_end_past,
      public.tm_kpi_judgment(
        s.actual_progress, s.actual_finish, s.actual_start,
        s.plan_start, s.plan_end, s.plan_days, s.plan_progress,
        v_asof, _caution_buffer, _worsen_gap
      ) AS judgment,
      (s.plan_start IS NULL) AS no_plan_start,
      (s.plan_end   IS NULL) AS no_plan_end
    FROM scoped s
  )
  SELECT jsonb_build_object(
    'total',              COUNT(*),
    'completed',          COUNT(*) FILTER (WHERE is_completed),
    'wip',                COUNT(*) FILTER (WHERE is_started AND NOT is_completed),
    'not_started',        COUNT(*) FILTER (WHERE NOT is_started AND NOT is_completed),
    'planned_started',    COUNT(*) FILTER (WHERE is_planned_started),
    'actual_started',     COUNT(*) FILTER (WHERE is_started),
    'in_delay',           COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')),
    'behind',             COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')),
    'start_delayed',      COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')
                                             AND is_planned_started AND NOT is_started),
    'completion_overdue', COUNT(*) FILTER (WHERE NOT is_completed AND judgment IN ('지연','악화')
                                             AND is_plan_end_past),
    'critical',           COUNT(*) FILTER (WHERE NOT is_completed AND judgment = '악화'),
    'no_plan_start',      COUNT(*) FILTER (WHERE no_plan_start),
    'no_plan_end',        COUNT(*) FILTER (WHERE no_plan_end),
    'j_caution',          COUNT(*) FILTER (WHERE judgment = '주의'),
    'j_normal',           COUNT(*) FILTER (WHERE judgment = '정상'),
    'j_delay',            COUNT(*) FILTER (WHERE judgment = '지연'),
    'j_worse',            COUNT(*) FILTER (WHERE judgment = '악화'),
    'j_completed',        COUNT(*) FILTER (WHERE judgment = '완료'),
    'as_of',              v_asof,
    'task_scope',         _task_scope
  ) INTO r
  FROM judged;

  RETURN COALESCE(r, jsonb_build_object('total', 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.tm_items_counts(text, jsonb, boolean, text, date, numeric, numeric)
  TO authenticated, service_role, anon;
