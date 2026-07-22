UPDATE defect_items_raw
SET rectified_status = 'Not start yet'
WHERE rectified_status = 'Not finish yet'
  AND actual_start_date IS NULL
  AND COALESCE(actual_progress_pct, 0) = 0
  AND actual_rectified_date IS NULL
  AND actual_closure_date IS NULL;