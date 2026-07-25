
-- ============================================================
-- sm_my_workspace_counts: 탭별 카운트 반환
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_my_workspace_counts(
  _mode text,
  _filter_value text,
  _today date
) RETURNS TABLE (
  today_count bigint,
  delayed_count bigint,
  upcoming_count bigint,
  in_progress_count bigint,
  completed_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      d.status_raw,
      d.actual_closure_date,
      d.actual_rectified_date,
      d.actual_progress_pct,
      d.planned_start_date,
      d.planned_rectified_date,
      d.planned_closure_date
    FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND CASE
        WHEN _mode = 'pic'  THEN d.hdec_pic_name = _filter_value
        WHEN _mode = 'team' THEN d.team          = _filter_value
        ELSE TRUE
      END
  ),
  flagged AS (
    SELECT
      status_raw,
      actual_progress_pct,
      planned_start_date,
      planned_rectified_date,
      planned_closure_date,
      (
        lower(btrim(coalesce(status_raw, ''))) IN ('closed','verified','rectified','complete','completed')
        OR actual_closure_date IS NOT NULL
        OR actual_rectified_date IS NOT NULL
      ) AS is_completed
    FROM base
  ),
  computed AS (
    SELECT
      is_completed,
      (NOT is_completed AND (
          planned_start_date     = _today
       OR planned_rectified_date = _today
       OR planned_closure_date   = _today
      )) AS is_today,
      (NOT is_completed
        AND coalesce(planned_closure_date, planned_rectified_date) IS NOT NULL
        AND coalesce(planned_closure_date, planned_rectified_date) < _today
      ) AS is_delayed,
      (NOT is_completed
        AND coalesce(planned_closure_date, planned_rectified_date) IS NOT NULL
        AND (coalesce(planned_closure_date, planned_rectified_date) - _today) BETWEEN 1 AND 3
      ) AS is_upcoming,
      (NOT is_completed AND (
        lower(btrim(coalesce(status_raw, ''))) IN ('in progress','inprogress','wip','under review')
        OR coalesce(actual_progress_pct, 0) > 0
      )) AS is_in_progress
    FROM flagged
  )
  SELECT
    count(*) FILTER (WHERE is_today)::bigint       AS today_count,
    count(*) FILTER (WHERE is_delayed)::bigint     AS delayed_count,
    count(*) FILTER (WHERE is_upcoming)::bigint    AS upcoming_count,
    count(*) FILTER (WHERE is_in_progress)::bigint AS in_progress_count,
    count(*) FILTER (WHERE is_completed)::bigint   AS completed_count,
    count(*)::bigint                               AS total_count
  FROM computed;
$$;

GRANT EXECUTE ON FUNCTION public.sm_my_workspace_counts(text, text, date) TO authenticated, service_role;

-- ============================================================
-- sm_my_workspace_rows: 지정 버킷에 해당하는 행 반환
-- ============================================================
CREATE OR REPLACE FUNCTION public.sm_my_workspace_rows(
  _mode text,
  _filter_value text,
  _today date,
  _bucket text,
  _limit int DEFAULT 5000,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  source_issue_no text,
  location_raw text,
  main_trade text,
  status_raw text,
  planned_start_date date,
  planned_closure_date date,
  planned_rectified_date date,
  actual_closure_date date,
  actual_rectified_date date,
  actual_progress_pct numeric,
  created_date timestamptz,
  created_at timestamptz,
  hdec_pic_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT d.*
    FROM public.defect_items_raw d
    WHERE d.is_active = true
      AND CASE
        WHEN _mode = 'pic'  THEN d.hdec_pic_name = _filter_value
        WHEN _mode = 'team' THEN d.team          = _filter_value
        ELSE TRUE
      END
  ),
  flagged AS (
    SELECT b.*,
      (
        lower(btrim(coalesce(b.status_raw, ''))) IN ('closed','verified','rectified','complete','completed')
        OR b.actual_closure_date IS NOT NULL
        OR b.actual_rectified_date IS NOT NULL
      ) AS is_completed
    FROM base b
  )
  SELECT
    f.id,
    f.source_issue_no,
    f.location_raw,
    f.main_trade,
    f.status_raw,
    f.planned_start_date,
    f.planned_closure_date,
    f.planned_rectified_date,
    f.actual_closure_date,
    f.actual_rectified_date,
    f.actual_progress_pct,
    f.created_date,
    f.created_at,
    f.hdec_pic_name
  FROM flagged f
  WHERE
    CASE _bucket
      WHEN 'today' THEN
        NOT f.is_completed AND (
          f.planned_start_date     = _today
       OR f.planned_rectified_date = _today
       OR f.planned_closure_date   = _today
        )
      WHEN 'delayed' THEN
        NOT f.is_completed
        AND coalesce(f.planned_closure_date, f.planned_rectified_date) IS NOT NULL
        AND coalesce(f.planned_closure_date, f.planned_rectified_date) < _today
      WHEN 'upcoming' THEN
        NOT f.is_completed
        AND coalesce(f.planned_closure_date, f.planned_rectified_date) IS NOT NULL
        AND (coalesce(f.planned_closure_date, f.planned_rectified_date) - _today) BETWEEN 1 AND 3
      WHEN 'in_progress' THEN
        NOT f.is_completed AND (
          lower(btrim(coalesce(f.status_raw, ''))) IN ('in progress','inprogress','wip','under review')
          OR coalesce(f.actual_progress_pct, 0) > 0
        )
      WHEN 'completed' THEN
        f.is_completed
      ELSE TRUE
    END
  ORDER BY f.source_issue_no NULLS LAST
  LIMIT _limit OFFSET _offset;
$$;

GRANT EXECUTE ON FUNCTION public.sm_my_workspace_rows(text, text, date, text, int, int) TO authenticated, service_role;
