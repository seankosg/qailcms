ALTER TABLE public.spare_parts_raw RENAME COLUMN physical_supply TO phy;

DELETE FROM public.spare_part_field_config WHERE field_name = 'physical_supply';
UPDATE public.spare_part_header_mappings SET target_field = 'phy' WHERE target_field = 'physical_supply';