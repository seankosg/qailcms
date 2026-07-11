ALTER TABLE public.spare_parts_raw
  DROP COLUMN IF EXISTS issue_technical,
  DROP COLUMN IF EXISTS issue_supplier,
  DROP COLUMN IF EXISTS issue_internal;

DELETE FROM public.spare_part_field_config
 WHERE field_name IN ('issue_technical','issue_supplier','issue_internal');

DELETE FROM public.spare_part_header_mappings
 WHERE target_field IN ('issue_technical','issue_supplier','issue_internal');