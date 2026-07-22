-- Backfill planned dates from actual dates for pre-2026-07-22 legacy rows
-- Rectified: rectified_status='Rectified' AND actual_rectified_date exists AND planned_rectified_date is null
UPDATE public.defect_items_raw
SET planned_rectified_date = actual_rectified_date
WHERE created_at < '2026-07-22'::timestamptz
  AND rectified_status = 'Rectified'
  AND actual_rectified_date IS NOT NULL
  AND planned_rectified_date IS NULL;

-- Start: Start Status = Done implies actual_start_date present (or status_raw in done-family, but then no actual to copy).
-- Copy actual_start_date → planned_start_date when planned missing.
UPDATE public.defect_items_raw
SET planned_start_date = actual_start_date
WHERE created_at < '2026-07-22'::timestamptz
  AND actual_start_date IS NOT NULL
  AND planned_start_date IS NULL;