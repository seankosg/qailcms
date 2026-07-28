-- ============================================================
-- R4: My Work Space TM/ABD counts & rows RPC
-- Rule 2 compliance: RETURNS jsonb (scalar) to bypass PostgREST 1,000-row cap
-- ============================================================

-- ---------- helper: TM current-plan / gap / started / completed ----------
-- Inline computed within each RPC using CTE (no separate helper to keep atomic).

-- ============================================================
-- tm_my_workspace_counts
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_my_workspace_counts(
  _mode text,
  _filter_value text,
  _today date
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      t.actual_progress,
      t.actual_start,
      t.auto_judgment,
      t.plan_start,
      t.plan_end,
      t.plan_days,
      t.plan_progress
    FROM public.task_management_raw t
    WHERE CASE
      WHEN _mode = 'pic'  THEN t.hdec_pic_name = _filter_value
      WHEN _mode = 'team' THEN t.team          = _filter_value
      ELSE TRUE
    END
  ),
  norm AS (
    SELECT
      -- actual normalized to [0,1] (DB 오염 대비: >1 이면 /100)
      LEAST(1.0, GREATEST(0.0,
        CASE
          WHEN COALESCE(actual_progress, 0) > 1 THEN COALESCE(actual_progress,0)/100.0
          ELSE COALESCE(actual_progress, 0)
        END
      ))::numeric AS act,
      actual_start,
      auto_judgment,
      plan_start,
      plan_end,
      plan_days,
      plan_progress
    FROM base
  ),
  flagged AS (
    SELECT
      act,
      actual_start,
      plan_start,
      plan_end,
      auto_judgment,
      (act >= 1.0 OR auto_judgment = '완료') AS is_completed,
      (act > 0 OR actual_start IS NOT NULL)  AS is_started_raw,
      -- computeTPlan: ((_today - plan_start) + 1) / plan_days_effective
      CASE
        WHEN plan_start IS NULL THEN NULL::numeric
        WHEN _today < plan_start THEN 0.0::numeric
        WHEN plan_end IS NOT NULL AND _today >= plan_end THEN 1.0::numeric
        ELSE LEAST(1.0, GREATEST(0.0,
          ( (_today - plan_start) + 1 )::numeric
          / NULLIF(
              COALESCE(
                NULLIF(plan_days, 0),
                CASE WHEN plan_end IS NOT NULL THEN GREATEST(1, (plan_end - plan_start) + 1) END
              ), 0)::numeric
        ))
      END AS tplan,
      plan_progress
    FROM norm
  ),
  computed AS (
    SELECT
      is_completed,
      is_started_raw AND NOT is_completed AS is_in_progress,
      -- delayed: 완료 아님 AND (미착수+plan_start<=today) OR (착수+gap<0)
      (NOT is_completed) AND (
        (NOT is_started_raw AND plan_start IS NOT NULL AND plan_start <= _today)
        OR
        (is_started_raw AND (
          act - COALESCE(
            CASE WHEN plan_progress IS NULL THEN NULL
                 WHEN plan_progress > 1 THEN plan_progress/100.0
                 ELSE plan_progress END,
            tplan
          ) < 0
        ))
      ) AS is_delayed,
      -- upcoming: 완료 아님 AND plan_end 이후 1~3일
      (NOT is_completed
        AND plan_end IS NOT NULL
        AND (plan_end - _today) BETWEEN 1 AND 3
      ) AS is_upcoming,
      -- today: 완료 아님 AND (plan_start=today OR plan_end=today)
      (NOT is_completed AND (plan_start = _today OR plan_end = _today)) AS is_today
    FROM flagged
  )
  SELECT jsonb_build_object(
    'today_count',       COUNT(*) FILTER (WHERE is_today),
    'delayed_count',     COUNT(*) FILTER (WHERE is_delayed),
    'upcoming_count',    COUNT(*) FILTER (WHERE is_upcoming),
    'in_progress_count', COUNT(*) FILTER (WHERE is_in_progress),
    'completed_count',   COUNT(*) FILTER (WHERE is_completed),
    'total_count',       COUNT(*)
  )
  FROM computed;
$$;

GRANT EXECUTE ON FUNCTION public.tm_my_workspace_counts(text, text, date) TO authenticated, service_role;

-- ============================================================
-- tm_my_workspace_rows
-- ============================================================
CREATE OR REPLACE FUNCTION public.tm_my_workspace_rows(
  _mode text,
  _filter_value text,
  _today date,
  _bucket text,
  _limit int DEFAULT 5000,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT t.*
    FROM public.task_management_raw t
    WHERE CASE
      WHEN _mode = 'pic'  THEN t.hdec_pic_name = _filter_value
      WHEN _mode = 'team' THEN t.team          = _filter_value
      ELSE TRUE
    END
  ),
  flagged AS (
    SELECT
      b.*,
      LEAST(1.0, GREATEST(0.0,
        CASE
          WHEN COALESCE(b.actual_progress, 0) > 1 THEN COALESCE(b.actual_progress,0)/100.0
          ELSE COALESCE(b.actual_progress, 0)
        END
      ))::numeric AS _act,
      CASE
        WHEN b.plan_start IS NULL THEN NULL::numeric
        WHEN _today < b.plan_start THEN 0.0::numeric
        WHEN b.plan_end IS NOT NULL AND _today >= b.plan_end THEN 1.0::numeric
        ELSE LEAST(1.0, GREATEST(0.0,
          ( (_today - b.plan_start) + 1 )::numeric
          / NULLIF(
              COALESCE(
                NULLIF(b.plan_days, 0),
                CASE WHEN b.plan_end IS NOT NULL THEN GREATEST(1, (b.plan_end - b.plan_start) + 1) END
              ), 0)::numeric
        ))
      END AS _tplan
    FROM base b
  ),
  computed AS (
    SELECT
      f.*,
      (f._act >= 1.0 OR f.auto_judgment = '완료') AS _is_completed,
      (f._act > 0 OR f.actual_start IS NOT NULL) AS _is_started_raw
    FROM flagged f
  ),
  filtered AS (
    SELECT c.*
    FROM computed c
    WHERE
      CASE _bucket
        WHEN 'today' THEN
          NOT c._is_completed AND (c.plan_start = _today OR c.plan_end = _today)
        WHEN 'delayed' THEN
          NOT c._is_completed AND (
            (NOT c._is_started_raw AND c.plan_start IS NOT NULL AND c.plan_start <= _today)
            OR
            (c._is_started_raw AND (
              c._act - COALESCE(
                CASE WHEN c.plan_progress IS NULL THEN NULL
                     WHEN c.plan_progress > 1 THEN c.plan_progress/100.0
                     ELSE c.plan_progress END,
                c._tplan
              ) < 0
            ))
          )
        WHEN 'upcoming' THEN
          NOT c._is_completed
          AND c.plan_end IS NOT NULL
          AND (c.plan_end - _today) BETWEEN 1 AND 3
        WHEN 'in_progress' THEN
          NOT c._is_completed AND c._is_started_raw
        WHEN 'completed' THEN
          c._is_completed
        ELSE TRUE  -- 'all'
      END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) - '_act' - '_tplan' - '_is_completed' - '_is_started_raw'
                            ORDER BY sub.task_no NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      f.id, f.task_no, f.main_task_no, f.task_name, f.level, f.hdec_pic_name,
      f.plan_end, f.actual_progress, f.auto_judgment, f.plan_start, f.plan_days,
      f.plan_progress, f.data_date, f.actual_start, f.actual_finish, f.slip_days,
      f.created_at,
      f._act, f._tplan, f._is_completed, f._is_started_raw
    FROM filtered f
    ORDER BY f.task_no NULLS LAST
    LIMIT _limit OFFSET _offset
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.tm_my_workspace_rows(text, text, date, text, int, int) TO authenticated, service_role;

-- ============================================================
-- abd_my_workspace_counts
-- ============================================================
CREATE OR REPLACE FUNCTION public.abd_my_workspace_counts(
  _mode text,
  _filter_value text,
  _today date
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT a.*
    FROM public.abd_items_raw a
    WHERE a.is_active = true
      AND CASE
        WHEN _mode = 'pic'  THEN a.hdec_pic_name = _filter_value
        WHEN _mode = 'team' THEN a.team          = _filter_value
        ELSE TRUE
      END
  ),
  staged AS (
    SELECT
      b.*,
      (UPPER(COALESCE(b.latest_status, '')) = 'A') AS is_approved,
      CASE
        WHEN COALESCE(b.r3_draft_finish_actual, b.r3_submission_actual, b.r3_dar_actual) IS NOT NULL THEN 'R3'
        WHEN COALESCE(b.r2_draft_finish_actual, b.r2_submission_actual, b.r2_dar_actual) IS NOT NULL THEN 'R2'
        WHEN COALESCE(b.r1_draft_finish_actual, b.r1_submission_actual, b.r1_dar_actual) IS NOT NULL THEN 'R1'
        ELSE 'Pending'
      END AS stage
    FROM base b
  ),
  computed AS (
    SELECT
      s.*,
      CASE s.stage
        WHEN 'R3' THEN COALESCE(s.r3_dar_plan, s.r3_submission_plan, s.r3_draft_finish_plan)
        WHEN 'R2' THEN COALESCE(s.r2_dar_plan, s.r2_submission_plan, s.r2_draft_finish_plan)
        ELSE          COALESCE(s.r1_dar_plan, s.r1_submission_plan, s.r1_draft_finish_plan)
      END AS current_plan
    FROM staged s
  )
  SELECT jsonb_build_object(
    'today_count',
      COUNT(*) FILTER (WHERE NOT is_approved AND current_plan = _today),
    'delayed_count',
      COUNT(*) FILTER (WHERE NOT is_approved AND current_plan IS NOT NULL AND current_plan < _today),
    'upcoming_count',
      COUNT(*) FILTER (WHERE NOT is_approved AND current_plan IS NOT NULL AND (current_plan - _today) BETWEEN 1 AND 3),
    'in_progress_count',
      COUNT(*) FILTER (WHERE NOT is_approved AND stage IN ('R1','R2','R3')),
    'completed_count',
      COUNT(*) FILTER (WHERE is_approved),
    'needs_planning_count',
      COUNT(*) FILTER (WHERE COALESCE(needs_planning, false) = true AND NOT is_approved AND COALESCE(is_terminated,false)=false),
    'total_count',
      COUNT(*)
  )
  FROM computed;
$$;

GRANT EXECUTE ON FUNCTION public.abd_my_workspace_counts(text, text, date) TO authenticated, service_role;

-- ============================================================
-- abd_my_workspace_rows
-- ============================================================
CREATE OR REPLACE FUNCTION public.abd_my_workspace_rows(
  _mode text,
  _filter_value text,
  _today date,
  _bucket text,
  _limit int DEFAULT 5000,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT a.*
    FROM public.abd_items_raw a
    WHERE a.is_active = true
      AND CASE
        WHEN _mode = 'pic'  THEN a.hdec_pic_name = _filter_value
        WHEN _mode = 'team' THEN a.team          = _filter_value
        ELSE TRUE
      END
  ),
  staged AS (
    SELECT
      b.*,
      (UPPER(COALESCE(b.latest_status, '')) = 'A') AS _is_approved,
      CASE
        WHEN COALESCE(b.r3_draft_finish_actual, b.r3_submission_actual, b.r3_dar_actual) IS NOT NULL THEN 'R3'
        WHEN COALESCE(b.r2_draft_finish_actual, b.r2_submission_actual, b.r2_dar_actual) IS NOT NULL THEN 'R2'
        WHEN COALESCE(b.r1_draft_finish_actual, b.r1_submission_actual, b.r1_dar_actual) IS NOT NULL THEN 'R1'
        ELSE 'Pending'
      END AS _stage
    FROM base b
  ),
  computed AS (
    SELECT
      s.*,
      CASE s._stage
        WHEN 'R3' THEN COALESCE(s.r3_dar_plan, s.r3_submission_plan, s.r3_draft_finish_plan)
        WHEN 'R2' THEN COALESCE(s.r2_dar_plan, s.r2_submission_plan, s.r2_draft_finish_plan)
        ELSE          COALESCE(s.r1_dar_plan, s.r1_submission_plan, s.r1_draft_finish_plan)
      END AS _current_plan
    FROM staged s
  ),
  filtered AS (
    SELECT c.*
    FROM computed c
    WHERE
      CASE _bucket
        WHEN 'today'         THEN NOT c._is_approved AND c._current_plan = _today
        WHEN 'delayed'       THEN NOT c._is_approved AND c._current_plan IS NOT NULL AND c._current_plan < _today
        WHEN 'upcoming'      THEN NOT c._is_approved AND c._current_plan IS NOT NULL AND (c._current_plan - _today) BETWEEN 1 AND 3
        WHEN 'in_progress'   THEN NOT c._is_approved AND c._stage IN ('R1','R2','R3')
        WHEN 'completed'     THEN c._is_approved
        WHEN 'needs_planning'THEN COALESCE(c.needs_planning,false)=true AND NOT c._is_approved AND COALESCE(c.is_terminated,false)=false
        ELSE TRUE  -- 'all'
      END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.abd_number NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      f.id, f.abd_number, f.document_title, f.latest_status, f.latest_rev,
      f.hdec_pic_name, f.needs_planning, f.active_round, f.is_terminated,
      f.r1_response_result, f.r2_response_result, f.r3_response_result,
      f.r1_draft_finish_plan, f.r1_draft_finish_actual,
      f.r1_submission_plan,   f.r1_submission_actual,
      f.r1_dar_plan,          f.r1_dar_actual,
      f.r2_draft_finish_plan, f.r2_draft_finish_actual,
      f.r2_submission_plan,   f.r2_submission_actual,
      f.r2_dar_plan,          f.r2_dar_actual,
      f.r3_draft_finish_plan, f.r3_draft_finish_actual,
      f.r3_submission_plan,   f.r3_submission_actual,
      f.r3_dar_plan,          f.r3_dar_actual,
      f.created_at
    FROM filtered f
    ORDER BY f.abd_number NULLS LAST
    LIMIT _limit OFFSET _offset
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.abd_my_workspace_rows(text, text, date, text, int, int) TO authenticated, service_role;