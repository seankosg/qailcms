export type BackupTableName =
  | "abd_items_raw"
  | "defect_items_raw"
  | "task_management_raw"
  | "dmr_entries"
  | "profiles"
  | "user_roles"
  | "team_master"
  | "subcontractor_master"
  | "dmr_contractor_master"
  | "dmr_system_master"
  | "defect_category_team_map"
  | "task_management_settings"
  | "abd_field_config"
  | "defect_field_config"
  | "task_management_field_config"
  | "abd_header_mappings"
  | "defect_header_mappings"
  | "task_management_header_mappings"
  | "abd_import_logs"
  | "defect_import_logs"
  | "task_management_import_logs"
  | "task_schedule_change_audit"
  | "abd_settings"
  | "abd_import_presets"
  | "abd_comments"
  | "abd_change_log"
  | "spl_items"
  | "spl_stage_catalog"
  | "spl_stage_progress"
  | "spl_change_log";

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
];

export const RAW_DATA_TABLES: BackupTableName[] = [
  "abd_items_raw",
  "defect_items_raw",
  "task_management_raw",
  "dmr_entries",
  "spl_items",
  "spl_stage_progress",
];

export type PreImportModule = "abd" | "sm" | "tm" | "spl";

export const MODULE_PRE_IMPORT_TABLES: Record<PreImportModule, BackupTableName[]> = {
  abd: ["abd_items_raw", "abd_import_logs", "abd_change_log"],
  sm: ["defect_items_raw", "defect_import_logs"],
  tm: ["task_management_raw", "task_management_import_logs", "task_schedule_change_audit"],
  spl: ["spl_items", "spl_stage_progress", "spl_change_log"],
};
