ALTER TABLE public.task_management_raw ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.task_management_raw ADD COLUMN IF NOT EXISTS floor_level text;

INSERT INTO public.task_management_field_config (field_name, display_name, is_visible, sort_order, group_key)
VALUES
  ('location', '위치', true, 65, 'task'),
  ('floor_level', '층', true, 66, 'task')
ON CONFLICT (field_name) DO NOTHING;

UPDATE public.task_management_field_config SET display_name = 'Tier' WHERE field_name = 'level';