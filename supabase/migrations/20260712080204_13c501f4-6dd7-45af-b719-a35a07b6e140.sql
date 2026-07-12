
-- Field Config에 origin, source_label 컬럼 추가
ALTER TABLE public.defect_field_config
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS source_label text;

ALTER TABLE public.defect_field_config
  DROP CONSTRAINT IF EXISTS defect_field_config_origin_check;
ALTER TABLE public.defect_field_config
  ADD CONSTRAINT defect_field_config_origin_check
    CHECK (origin IS NULL OR origin IN ('hdec', 'aconex', 'system'));

-- 규칙 기반 origin 초기값
UPDATE public.defect_field_config
SET origin = CASE
  WHEN field_name IN ('source_issue_no','category','defect_type','item','description','priority','due_by','status_raw','completion_status','closure_status','classification','location_raw','area_type','area_level','area_location','plan_title','plan_group','created_by_name','created_by_team_name','created_date','last_updated_at','ir','forms','updated_description','updated_by_name','updated_status','updated_date_raw','location_reference','podium_area','data_date','assigned_to') THEN 'aconex'
  WHEN field_name LIKE 'hdec\_%' OR field_name IN ('main_trade','sub_trade','work_type','subcontractor_name','subsub_name','planned_start_date','planned_completion_date','planned_closure_date','actual_start_date','actual_completion_date','actual_closure_date','planned_progress_pct','actual_progress_pct','remarks','is_critical') THEN 'hdec'
  ELSE 'system'
END
WHERE origin IS NULL;

UPDATE public.defect_field_config
SET source_label = CASE origin
  WHEN 'hdec' THEN 'HDEC'
  WHEN 'aconex' THEN 'Aconex'
  ELSE 'System'
END
WHERE source_label IS NULL;
