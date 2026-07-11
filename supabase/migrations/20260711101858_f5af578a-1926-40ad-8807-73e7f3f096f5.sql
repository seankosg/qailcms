
ALTER TABLE public.task_management_raw ADD COLUMN IF NOT EXISTS team text;
CREATE INDEX IF NOT EXISTS idx_tmr_team ON public.task_management_raw(team);
UPDATE public.task_management_raw SET team = discipline WHERE team IS NULL;

INSERT INTO public.task_management_field_config (field_name, display_name, sort_order, group_key)
VALUES ('team','Team',25,'id')
ON CONFLICT (field_name) DO NOTHING;

INSERT INTO public.task_management_header_mappings (module, source_header, target_field, is_custom)
VALUES
  ('task_management','Team','team',false),
  ('task_management','팀','team',false)
ON CONFLICT (module, source_header) DO NOTHING;
