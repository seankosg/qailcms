CREATE OR REPLACE FUNCTION public.get_backup_tables()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    'abd_items_raw','defect_items_raw','task_management_raw','dmr_entries',
    'profiles','user_roles','team_master','subcontractor_master','dmr_contractor_master',
    'dmr_system_master','defect_category_team_map',
    'task_management_settings','abd_field_config','defect_field_config','task_management_field_config',
    'abd_header_mappings','defect_header_mappings','task_management_header_mappings',
    'abd_import_logs','defect_import_logs','task_management_import_logs','task_schedule_change_audit',
    'abd_settings','abd_import_presets','abd_comments','abd_change_log',
    'spl_items','spl_stage_catalog','spl_stage_progress','spl_change_log','spl_settings','spl_import_logs',
    'wrt_items','wrt_stage_catalog','wrt_stage_progress','wrt_change_log','wrt_settings','wrt_import_logs',
    'rcl_permissions','rcl_module_config','rcl_permissions_audit','rcl_module_config_audit',
    'hdec_eng_name_master','hdec_pic_name_master','hdec_name_propagation_log',
    'user_view_preferences','tm_alarm_settings','tm_milestone_config','tm_milestone_config_audit',
    'tm_milestone_kinds','defect_hdec_pic_rules','defect_subcon_rules','defect_import_presets',
    'task_comments','defect_comments','defect_status_history','task_management_status_history',
    'abd_ocs_import_logs','abd_ocs_comments','abd_ocs_comment_groups','abd_ocs_comment_abd_links',
    'abd_ocs_compliance','abd_ocs_attachments','abd_ocs_attachment_comment_links','abd_ocs_compliance_log',
    'abd_ocs_response_segments','abd_ocs_response_comment_links','abd_ocs_source_files',
    'abd_ocs_number_correction_log'
  ]::text[];
  v_missing text[];
BEGIN
  -- 영구 abd_ocs_% 테이블(스테이징 abd_ocs_v3_stage_% 및 run-scoped 검증 영수증 테이블 제외)이 목록에서 빠지면 조용히 진행하지 않는다.
  SELECT coalesce(array_agg(t.table_name ORDER BY t.table_name), '{}')
    INTO v_missing
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name LIKE 'abd_ocs_%'
    AND t.table_name NOT LIKE 'abd_ocs_v3_stage_%'
    AND t.table_name <> 'abd_ocs_inc_verify_receipts'
    AND NOT (t.table_name = ANY (v_tables));

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'backup table list is missing permanent OCS tables: %', array_to_string(v_missing, ', ');
  END IF;

  RETURN v_tables;
END
$function$;