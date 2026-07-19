-- Staging table for one-time 2026-07-16 SM raw data migration
CREATE TABLE IF NOT EXISTS public._tmp_defect_import_20260716 (
  source_issue_no text,
  team text, status_raw text, priority text,
  hdec_verification text, hdec_reason text, hdec_comments text,
  hdec_pic_name text, hdec_eng_name text,
  classification text, category text, defect_type text,
  item text, description text, location_raw text, defect_location text,
  area_type text, area_level text, area_location text, location_reference text, podium_area text,
  building text, room text, room_group text, level_name text,
  plan_title text, plan_group text, main_trade text, sub_trade text, trade_detail text, work_type text,
  assigned_to text, subcontractor_name text, subsub_name text,
  captured_by_name text, created_by_name text, created_by_team_name text,
  created_date timestamptz, due_by date,
  planned_start_date date, actual_start_date date,
  planned_rectified_date date, actual_rectified_date date, rectified_status text,
  planned_closure_date date, actual_closure_date date, closure_status text,
  planned_progress_pct numeric, actual_progress_pct numeric,
  last_updated_at timestamptz, updated_status text, updated_description text,
  updated_by_name text, updated_date_raw timestamptz,
  remarks text, ir text, forms text,
  subcontractor_issue_no text, review_flag text, is_critical boolean,
  data_date date, raw_payload jsonb
);
GRANT ALL ON public._tmp_defect_import_20260716 TO service_role, authenticated;