ALTER TABLE public.spare_parts_raw RENAME TO spare_parts_raw_archived;
ALTER TABLE public.spare_parts_import_logs RENAME TO spare_parts_import_logs_archived;
ALTER TABLE public.spare_parts_sync_log RENAME TO spare_parts_sync_log_archived;
ALTER TABLE public.spare_part_change_log RENAME TO spare_part_change_log_archived;
ALTER TABLE public.spare_part_comments RENAME TO spare_part_comments_archived;
ALTER TABLE public.spare_part_custom_fields RENAME TO spare_part_custom_fields_archived;
ALTER TABLE public.spare_part_field_config RENAME TO spare_part_field_config_archived;
ALTER TABLE public.spare_part_header_mappings RENAME TO spare_part_header_mappings_archived;
ALTER TABLE public.spare_part_import_row_logs RENAME TO spare_part_import_row_logs_archived;
ALTER TABLE public.spare_part_status_history RENAME TO spare_part_status_history_archived;
ALTER TABLE public.spare_part_status_mapping RENAME TO spare_part_status_mapping_archived;

DROP FUNCTION IF EXISTS public.delete_spare_part_import_batch(uuid);
DROP FUNCTION IF EXISTS public.preview_rollback_spare_part_import(uuid);
DROP FUNCTION IF EXISTS public.rollback_spare_part_import(uuid, boolean);
DROP FUNCTION IF EXISTS public.spare_parts_auto_owner_user_id() CASCADE;

CREATE OR REPLACE FUNCTION public.get_backup_tables()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'abd_items_raw',
    'defect_items_raw',
    'task_management_raw',
    'dmr_entries',
    'profiles',
    'user_roles',
    'team_master',
    'subcontractor_master',
    'dmr_contractor_master',
    'dmr_system_master',
    'defect_category_team_map',
    'task_management_settings',
    'abd_field_config',
    'defect_field_config',
    'task_management_field_config',
    'abd_header_mappings',
    'defect_header_mappings',
    'task_management_header_mappings',
    'abd_import_logs',
    'defect_import_logs',
    'task_management_import_logs',
    'task_schedule_change_audit',
    'abd_settings',
    'abd_import_presets',
    'abd_comments',
    'abd_change_log',
    'spl_items',
    'spl_stage_catalog',
    'spl_stage_progress',
    'spl_change_log'
  ]::text[];
$function$;