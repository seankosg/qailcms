UPDATE public.spare_parts_raw
   SET physical_supply = COALESCE(physical_supply, phy)
 WHERE physical_supply IS NULL AND phy IS NOT NULL;

ALTER TABLE public.spare_parts_raw DROP COLUMN IF EXISTS phy;

DELETE FROM public.spare_part_field_config WHERE field_name = 'phy';
DELETE FROM public.spare_part_header_mappings WHERE target_field = 'phy';