CREATE INDEX IF NOT EXISTS idx_defect_items_raw_progress_dates
  ON public.defect_items_raw (id)
  INCLUDE (planned_start_date, planned_rectified_date, planned_pre_inspection_date,
           planned_dar_inspection_date, planned_closure_date, planned_ho_date,
           actual_start_date, actual_rectified_date, actual_pre_inspection_date,
           actual_dar_inspection_date, actual_closure_date, actual_ho_date)
  WHERE is_active = true;

ANALYZE public.defect_items_raw;