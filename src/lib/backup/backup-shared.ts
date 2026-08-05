export type BackupTableName =
  // === 원본 데이터 ===
  | "abd_items_raw"
  | "defect_items_raw"
  | "task_management_raw"
  | "dmr_entries"
  // === 계정/조직 ===
  | "profiles"
  | "user_roles"
  | "team_master"
  | "subcontractor_master"
  | "dmr_contractor_master"
  | "dmr_system_master"
  | "defect_category_team_map"
  // === 설정/매핑 ===
  | "task_management_settings"
  | "abd_field_config"
  | "defect_field_config"
  | "task_management_field_config"
  | "abd_header_mappings"
  | "defect_header_mappings"
  | "task_management_header_mappings"
  // === 임포트 실행 로그(배치 단위) ===
  | "abd_import_logs"
  | "defect_import_logs"
  | "task_management_import_logs"
  | "task_schedule_change_audit"
  // === ABD ===
  | "abd_settings"
  | "abd_import_presets"
  | "abd_comments"
  | "abd_change_log"
  // === SPL ===
  | "spl_items"
  | "spl_stage_catalog"
  | "spl_stage_progress"
  | "spl_change_log"
  | "spl_settings"
  | "spl_import_logs"
  // === WRT ===
  | "wrt_items"
  | "wrt_stage_catalog"
  | "wrt_stage_progress"
  | "wrt_change_log"
  | "wrt_settings"
  | "wrt_import_logs"
  // === RCL 권한 정본·감사 ===
  | "rcl_permissions"
  | "rcl_module_config"
  | "rcl_permissions_audit"
  | "rcl_module_config_audit"
  // === HDEC 명부·전파 감사 ===
  | "hdec_eng_name_master"
  | "hdec_pic_name_master"
  | "hdec_name_propagation_log"
  // === 사용자 설정·업무 설정·감사 ===
  | "user_view_preferences"
  | "tm_alarm_settings"
  | "tm_milestone_config"
  | "tm_milestone_config_audit"
  | "tm_milestone_kinds"
  | "defect_hdec_pic_rules"
  | "defect_subcon_rules"
  | "defect_import_presets"
  // === 사용자 입력·상태 이력 ===
  | "task_comments"
  | "defect_comments"
  | "defect_status_history"
  | "task_management_status_history"
  // === ABD OCS ===
  | "abd_ocs_import_logs"
  | "abd_ocs_comments"
  | "abd_ocs_comment_groups"
  | "abd_ocs_comment_abd_links"
  | "abd_ocs_compliance"
  | "abd_ocs_attachments"
  | "abd_ocs_attachment_comment_links"
  | "abd_ocs_compliance_log"
  | "abd_ocs_response_segments"
  | "abd_ocs_response_comment_links"
  | "abd_ocs_source_files"
  | "abd_ocs_number_correction_log";

/**
 * 백업 대상 정본 목록.
 * 반드시 backup-core.server.ts 의 TABLE_SORT_KEYS 및 DB 의 public.get_backup_tables() 와 동일 집합이어야 합니다.
 */
export const BACKUP_TABLES: BackupTableName[] = [
  "abd_items_raw",
  "defect_items_raw",
  "task_management_raw",
  "dmr_entries",
  "profiles",
  "user_roles",
  "team_master",
  "subcontractor_master",
  "dmr_contractor_master",
  "dmr_system_master",
  "defect_category_team_map",
  "task_management_settings",
  "abd_field_config",
  "defect_field_config",
  "task_management_field_config",
  "abd_header_mappings",
  "defect_header_mappings",
  "task_management_header_mappings",
  "abd_import_logs",
  "defect_import_logs",
  "task_management_import_logs",
  "task_schedule_change_audit",
  "abd_settings",
  "abd_import_presets",
  "abd_comments",
  "abd_change_log",
  "spl_items",
  "spl_stage_catalog",
  "spl_stage_progress",
  "spl_change_log",
  "spl_settings",
  "spl_import_logs",
  "wrt_items",
  "wrt_stage_catalog",
  "wrt_stage_progress",
  "wrt_change_log",
  "wrt_settings",
  "wrt_import_logs",
  "rcl_permissions",
  "rcl_module_config",
  "rcl_permissions_audit",
  "rcl_module_config_audit",
  "hdec_eng_name_master",
  "hdec_pic_name_master",
  "hdec_name_propagation_log",
  "user_view_preferences",
  "tm_alarm_settings",
  "tm_milestone_config",
  "tm_milestone_config_audit",
  "tm_milestone_kinds",
  "defect_hdec_pic_rules",
  "defect_subcon_rules",
  "defect_import_presets",
  "task_comments",
  "defect_comments",
  "defect_status_history",
  "task_management_status_history",
  "abd_ocs_import_logs",
  "abd_ocs_comments",
  "abd_ocs_comment_groups",
  "abd_ocs_comment_abd_links",
  "abd_ocs_compliance",
  "abd_ocs_attachments",
  "abd_ocs_attachment_comment_links",
  "abd_ocs_compliance_log",
  "abd_ocs_response_segments",
  "abd_ocs_response_comment_links",
  "abd_ocs_source_files",
  "abd_ocs_number_correction_log",
];

export const RAW_DATA_TABLES: BackupTableName[] = [
  "abd_items_raw",
  "defect_items_raw",
  "task_management_raw",
  "dmr_entries",
  "spl_items",
  "spl_stage_progress",
  "wrt_items",
  "wrt_stage_progress",
];

export type PreImportModule = "abd" | "sm" | "tm" | "spl" | "wrt";

export const MODULE_PRE_IMPORT_TABLES: Record<PreImportModule, BackupTableName[]> = {
  abd: [
    "abd_items_raw",
    "abd_import_logs",
    "abd_change_log",
    "abd_ocs_import_logs",
    "abd_ocs_comments",
    "abd_ocs_comment_groups",
    "abd_ocs_comment_abd_links",
    "abd_ocs_compliance",
    "abd_ocs_attachments",
    "abd_ocs_attachment_comment_links",
    "abd_ocs_compliance_log",
    "abd_ocs_response_segments",
    "abd_ocs_response_comment_links",
    "abd_ocs_source_files",
    "abd_ocs_number_correction_log",
  ],
  sm: ["defect_items_raw", "defect_import_logs", "defect_status_history"],
  tm: [
    "task_management_raw",
    "task_management_import_logs",
    "task_schedule_change_audit",
    "task_management_status_history",
  ],
  spl: ["spl_items", "spl_stage_progress", "spl_change_log", "spl_import_logs"],
  wrt: ["wrt_items", "wrt_stage_progress", "wrt_change_log", "wrt_import_logs"],
};
