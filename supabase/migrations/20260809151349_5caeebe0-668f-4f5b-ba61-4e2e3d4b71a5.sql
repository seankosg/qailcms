INSERT INTO public.defect_field_config (field_name, display_name, is_visible, sort_order, group_key, origin, source_label)
VALUES
  ('planned_pre_inspection_date','P.Pre-Ins', true, 650, 'progress', 'hdec', 'HDEC'),
  ('actual_pre_inspection_date','A.Pre-Ins', true, 660, 'progress', 'hdec', 'HDEC'),
  ('planned_dar_inspection_date','P.DAR-Ins', true, 670, 'progress', 'hdec', 'HDEC'),
  ('actual_dar_inspection_date','A.DAR-Ins', true, 680, 'progress', 'hdec', 'HDEC'),
  ('planned_ho_date','P.H/O', true, 690, 'progress', 'hdec', 'HDEC'),
  ('actual_ho_date','A.H/O', true, 700, 'progress', 'hdec', 'HDEC')
ON CONFLICT (field_name) DO NOTHING;