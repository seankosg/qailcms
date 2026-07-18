
CREATE INDEX IF NOT EXISTS idx_defect_items_raw_progress_cover
ON public.defect_items_raw (team)
INCLUDE (
  plan_group, subcontractor_name, subsub_name, hdec_pic_name, hdec_eng_name,
  area_level, main_trade, sub_trade, work_type,
  planned_start_date, planned_rectified_date, planned_closure_date,
  actual_start_date, actual_rectified_date, actual_closure_date,
  actual_progress_pct, room_group
)
WHERE is_active = true AND status_group = 'unclosed';
