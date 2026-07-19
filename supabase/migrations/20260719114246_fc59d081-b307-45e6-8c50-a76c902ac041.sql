ALTER TABLE public.defect_field_config DROP CONSTRAINT defect_field_config_origin_check;
ALTER TABLE public.defect_field_config ADD CONSTRAINT defect_field_config_origin_check
  CHECK (origin IS NULL OR origin = ANY (ARRAY['hdec','aconex','system','derived']));

INSERT INTO public.defect_field_config (field_name, display_name, origin, source_label, group_key, sort_order, is_visible)
VALUES ('start_status', 'Start Status', 'derived', 'Derived', 'progress', 178, true)
ON CONFLICT (field_name) DO NOTHING;