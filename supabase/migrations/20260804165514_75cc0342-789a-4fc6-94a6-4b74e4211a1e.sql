CREATE OR REPLACE FUNCTION public.get_backup_tables()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    -- === 기존 30 ===
    'abd_items_raw','defect_items_raw','task_management_raw','dmr_entries','profiles','user_roles',
    'team_master','subcontractor_master','dmr_contractor_master','dmr_system_master',
    'defect_category_team_map','task_management_settings','abd_field_config','defect_field_config',
    'task_management_field_config','abd_header_mappings','defect_header_mappings',
    'task_management_header_mappings','abd_import_logs','defect_import_logs',
    'task_management_import_logs','task_schedule_change_audit','abd_settings','abd_import_presets',
    'abd_comments','abd_change_log',
    'spl_items','spl_stage_catalog','spl_stage_progress','spl_change_log',
    -- === WRT ===
    'wrt_items','wrt_stage_catalog','wrt_stage_progress','wrt_change_log','wrt_settings','wrt_import_logs',
    -- === SPL 추가 ===
    'spl_settings','spl_import_logs',
    -- === RCL 권한 정본·감사 ===
    'rcl_permissions','rcl_module_config','rcl_permissions_audit','rcl_module_config_audit',
    -- === HDEC 명부·전파 감사 ===
    'hdec_eng_name_master','hdec_pic_name_master','hdec_name_propagation_log',
    -- === 사용자 설정·업무 설정·감사 ===
    'user_view_preferences','tm_alarm_settings','tm_milestone_config','tm_milestone_config_audit',
    'tm_milestone_kinds','defect_hdec_pic_rules','defect_subcon_rules','defect_import_presets',
    -- === 사용자 입력·상태 이력 ===
    'task_comments','defect_comments','defect_status_history','task_management_status_history'
  ]::text[];
$function$;