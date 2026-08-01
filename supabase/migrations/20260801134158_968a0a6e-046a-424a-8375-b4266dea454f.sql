
-- SM MWS: status_raw 문자열 매칭 폐지 → _snag_done_asof 정본 경유
CREATE OR REPLACE FUNCTION public.sm_my_workspace_counts(_mode text, _filter_value text, _today date)
RETURNS TABLE(today_count bigint, delayed_count bigint, upcoming_count bigint, in_progress_count bigint, completed_count bigint, total_count bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT d.* FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND CASE WHEN _mode='pic' THEN d.hdec_pic_name=_filter_value
               WHEN _mode='team' THEN d.team=_filter_value ELSE TRUE END
  ),
  flagged AS (
    SELECT
      b.planned_start_date, b.planned_rectified_date, b.planned_closure_date,
      public._snag_done_asof('start', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_start,
      public._snag_done_asof('rectified', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_rect,
      public._snag_done_asof('closure', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_close
    FROM base b
  ),
  computed AS (
    SELECT d_close AS is_completed,
      (NOT d_close AND (planned_start_date=_today OR planned_rectified_date=_today OR planned_closure_date=_today)) AS is_today,
      (NOT d_close AND coalesce(planned_closure_date, planned_rectified_date) IS NOT NULL
        AND coalesce(planned_closure_date, planned_rectified_date) < _today) AS is_delayed,
      (NOT d_close AND coalesce(planned_closure_date, planned_rectified_date) IS NOT NULL
        AND (coalesce(planned_closure_date, planned_rectified_date) - _today) BETWEEN 1 AND 3) AS is_upcoming,
      (NOT d_close AND (d_start OR d_rect)) AS is_in_progress
    FROM flagged
  )
  SELECT count(*) FILTER (WHERE is_today)::bigint,
         count(*) FILTER (WHERE is_delayed)::bigint,
         count(*) FILTER (WHERE is_upcoming)::bigint,
         count(*) FILTER (WHERE is_in_progress)::bigint,
         count(*) FILTER (WHERE is_completed)::bigint,
         count(*)::bigint
  FROM computed;
$fn$;

CREATE OR REPLACE FUNCTION public.sm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, source_issue_no text, location_raw text, main_trade text, status_raw text, planned_start_date date, planned_closure_date date, planned_rectified_date date, actual_closure_date date, actual_rectified_date date, actual_progress_pct numeric, created_date timestamp with time zone, created_at timestamp with time zone, hdec_pic_name text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT d.* FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND CASE WHEN _mode='pic' THEN d.hdec_pic_name=_filter_value
               WHEN _mode='team' THEN d.team=_filter_value ELSE TRUE END
  ),
  flagged AS (
    SELECT b.*,
      public._snag_done_asof('start', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_start,
      public._snag_done_asof('rectified', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_rect,
      public._snag_done_asof('closure', b.status_raw, b.actual_start_date, b.actual_rectified_date, b.actual_closure_date,
        public._snag_progress_norm(b.actual_progress_pct), _today) AS d_close
    FROM base b
  )
  SELECT f.id, f.source_issue_no, f.location_raw, f.main_trade, f.status_raw,
         f.planned_start_date, f.planned_closure_date, f.planned_rectified_date,
         CASE WHEN f.actual_closure_date <= _today THEN f.actual_closure_date END,
         CASE WHEN f.actual_rectified_date <= _today THEN f.actual_rectified_date END,
         f.actual_progress_pct, f.created_date, f.created_at, f.hdec_pic_name
  FROM flagged f
  WHERE CASE _bucket
    WHEN 'today' THEN NOT f.d_close AND (f.planned_start_date=_today OR f.planned_rectified_date=_today OR f.planned_closure_date=_today)
    WHEN 'delayed' THEN NOT f.d_close AND coalesce(f.planned_closure_date, f.planned_rectified_date) IS NOT NULL
      AND coalesce(f.planned_closure_date, f.planned_rectified_date) < _today
    WHEN 'upcoming' THEN NOT f.d_close AND coalesce(f.planned_closure_date, f.planned_rectified_date) IS NOT NULL
      AND (coalesce(f.planned_closure_date, f.planned_rectified_date) - _today) BETWEEN 1 AND 3
    WHEN 'in_progress' THEN NOT f.d_close AND (f.d_start OR f.d_rect)
    WHEN 'completed' THEN f.d_close
    ELSE TRUE END
  ORDER BY f.source_issue_no NULLS LAST
  LIMIT _limit OFFSET _offset;
$fn$;

-- ABD MWS: latest_status='A' 직접 참조 폐지 → abd_judge_v1 정본 경유
CREATE OR REPLACE FUNCTION public.abd_my_workspace_counts(_mode text, _filter_value text, _today date)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT a.* FROM public.abd_items_raw a
    WHERE a.is_active = true
      AND CASE WHEN _mode='pic' THEN a.hdec_pic_name=_filter_value
               WHEN _mode='team' THEN a.team=_filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT b.*, public.abd_judge_v1(b.*, _today) AS j FROM base b
  ),
  computed AS (
    SELECT
      (j->>'bucket_top') = 'Approved' AS is_approved,
      COALESCE((j->>'judgment_unavailable')::boolean, false) AS unavailable,
      COALESCE((j->>'needs_planning')::boolean, false) OR COALESCE((j->>'needs_revise')::boolean, false) AS needs_plan,
      (j->>'completed_stage') IS NOT NULL AS has_actual,
      CASE (j->>'active_round')::int
        WHEN 3 THEN COALESCE(r3_dar_plan, r3_submission_plan, r3_draft_finish_plan)
        WHEN 2 THEN COALESCE(r2_dar_plan, r2_submission_plan, r2_draft_finish_plan)
        ELSE COALESCE(r1_dar_plan, r1_submission_plan, r1_draft_finish_plan)
      END AS current_plan
    FROM judged
  )
  SELECT jsonb_build_object(
    'today_count', COUNT(*) FILTER (WHERE NOT is_approved AND NOT unavailable AND current_plan = _today),
    'delayed_count', COUNT(*) FILTER (WHERE NOT is_approved AND NOT unavailable AND current_plan IS NOT NULL AND current_plan < _today),
    'upcoming_count', COUNT(*) FILTER (WHERE NOT is_approved AND NOT unavailable AND current_plan IS NOT NULL AND (current_plan - _today) BETWEEN 1 AND 3),
    'in_progress_count', COUNT(*) FILTER (WHERE NOT is_approved AND NOT unavailable AND has_actual),
    'completed_count', COUNT(*) FILTER (WHERE is_approved),
    'needs_planning_count', COUNT(*) FILTER (WHERE NOT is_approved AND NOT unavailable AND needs_plan),
    'total_count', COUNT(*)
  ) FROM computed;
$fn$;

CREATE OR REPLACE FUNCTION public.abd_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit integer DEFAULT 5000, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT a.* FROM public.abd_items_raw a
    WHERE a.is_active = true
      AND CASE WHEN _mode='pic' THEN a.hdec_pic_name=_filter_value
               WHEN _mode='team' THEN a.team=_filter_value ELSE TRUE END
  ),
  judged AS (
    SELECT b.*, public.abd_judge_v1(b.*, _today) AS j FROM base b
  ),
  computed AS (
    SELECT c.*,
      (c.j->>'bucket_top') = 'Approved' AS _is_approved,
      COALESCE((c.j->>'judgment_unavailable')::boolean, false) AS _unavailable,
      COALESCE((c.j->>'needs_planning')::boolean, false) OR COALESCE((c.j->>'needs_revise')::boolean, false) AS _needs_plan,
      (c.j->>'completed_stage') IS NOT NULL AS _has_actual,
      CASE (c.j->>'active_round')::int
        WHEN 3 THEN COALESCE(c.r3_dar_plan, c.r3_submission_plan, c.r3_draft_finish_plan)
        WHEN 2 THEN COALESCE(c.r2_dar_plan, c.r2_submission_plan, c.r2_draft_finish_plan)
        ELSE COALESCE(c.r1_dar_plan, c.r1_submission_plan, c.r1_draft_finish_plan)
      END AS _current_plan
    FROM judged c
  ),
  filtered AS (
    SELECT * FROM computed c
    WHERE CASE _bucket
      WHEN 'today' THEN NOT c._is_approved AND NOT c._unavailable AND c._current_plan = _today
      WHEN 'delayed' THEN NOT c._is_approved AND NOT c._unavailable AND c._current_plan IS NOT NULL AND c._current_plan < _today
      WHEN 'upcoming' THEN NOT c._is_approved AND NOT c._unavailable AND c._current_plan IS NOT NULL AND (c._current_plan - _today) BETWEEN 1 AND 3
      WHEN 'in_progress' THEN NOT c._is_approved AND NOT c._unavailable AND c._has_actual
      WHEN 'completed' THEN c._is_approved
      WHEN 'needs_planning' THEN NOT c._is_approved AND NOT c._unavailable AND c._needs_plan
      ELSE TRUE END
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.abd_number NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT f.id, f.abd_number, f.document_title, f.latest_status, f.latest_rev,
      f.hdec_pic_name, f._needs_plan AS needs_planning, (f.j->>'active_round')::int AS active_round, f.is_terminated,
      f.r1_response_result, f.r2_response_result, f.r3_response_result,
      f.r1_draft_finish_plan, f.r1_draft_finish_actual, f.r1_submission_plan, f.r1_submission_actual, f.r1_dar_plan, f.r1_dar_actual,
      f.r2_draft_finish_plan, f.r2_draft_finish_actual, f.r2_submission_plan, f.r2_submission_actual, f.r2_dar_plan, f.r2_dar_actual,
      f.r3_draft_finish_plan, f.r3_draft_finish_actual, f.r3_submission_plan, f.r3_submission_actual, f.r3_dar_plan, f.r3_dar_actual,
      f.created_at
    FROM filtered f
    ORDER BY f.abd_number NULLS LAST
    LIMIT _limit OFFSET _offset
  ) sub;
$fn$;
