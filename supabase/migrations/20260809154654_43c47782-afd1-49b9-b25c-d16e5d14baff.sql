INSERT INTO public.defect_header_mappings (module, source_header, target_field, is_custom, is_active, note)
VALUES
  ('defect_management', 'planned_Pre-Inspection_date', 'planned_pre_inspection_date', false, true, 'Re-import 파일 헤더(하이픈 표기)'),
  ('defect_management', 'actual_Pre-Inspection_date',  'actual_pre_inspection_date',  false, true, 'Re-import 파일 헤더(하이픈 표기)'),
  ('defect_management', 'planned_DAR-Inspection_date', 'planned_dar_inspection_date', false, true, 'Re-import 파일 헤더(하이픈 표기)'),
  ('defect_management', 'actual_DAR-Inspection_date',  'actual_dar_inspection_date',  false, true, 'Re-import 파일 헤더(하이픈 표기)'),
  ('defect_management', 'planned_H/O_date',            'planned_ho_date',             false, true, 'Re-import 파일 헤더(슬래시 표기)'),
  ('defect_management', 'actual_H/O_date',             'actual_ho_date',              false, true, 'Re-import 파일 헤더(슬래시 표기)')
ON CONFLICT DO NOTHING;