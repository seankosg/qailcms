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
  | "abd_ocs_number_correction_log"
  // === SPL OCS / RSP / Documents ===
  | "spl_ocs_import_logs"
  | "spl_rsp_items"
  | "spl_ocs_comment_groups"
  | "spl_ocs_comments"
  | "spl_ocs_comment_spl_links"
  | "spl_ocs_comment_rsp_links"
  | "spl_ocs_categories"
  | "spl_ocs_categories_mapping"
  | "spl_ocs_attachments"
  | "spl_ocs_attachment_comment_links"
  | "spl_ocs_compliance"
  | "spl_ocs_compliance_log"
  | "spl_ocs_source_files"
  | "spl_documents"
  | "spl_document_item_links"
  | "spl_document_pages"
  | "spl_ocs_comment_document_links";

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
  "spl_ocs_import_logs",
  "spl_rsp_items",
  "spl_ocs_comment_groups",
  "spl_ocs_comments",
  "spl_ocs_comment_spl_links",
  "spl_ocs_comment_rsp_links",
  "spl_ocs_categories",
  "spl_ocs_categories_mapping",
  "spl_ocs_attachments",
  "spl_ocs_attachment_comment_links",
  "spl_ocs_compliance",
  "spl_ocs_compliance_log",
  "spl_ocs_source_files",
  "spl_documents",
  "spl_document_item_links",
  "spl_document_pages",
  "spl_ocs_comment_document_links",
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
  spl: [
    "spl_items",
    "spl_stage_progress",
    "spl_change_log",
    "spl_import_logs",
    "spl_ocs_import_logs",
    "spl_rsp_items",
    "spl_ocs_comment_groups",
    "spl_ocs_comments",
    "spl_ocs_comment_spl_links",
    "spl_ocs_comment_rsp_links",
    "spl_ocs_categories",
    "spl_ocs_categories_mapping",
    "spl_ocs_attachments",
    "spl_ocs_attachment_comment_links",
    "spl_ocs_compliance",
    "spl_ocs_compliance_log",
    "spl_ocs_source_files",
    "spl_documents",
    "spl_document_item_links",
    "spl_document_pages",
    "spl_ocs_comment_document_links",
  ],
  wrt: ["wrt_items", "wrt_stage_progress", "wrt_change_log", "wrt_items"].filter(
    (t, i, a) => a.indexOf(t) === i,
  ) as BackupTableName[],
};

// ===========================================================================
// 복원 범위 계약 (Holding Point 2)
// ---------------------------------------------------------------------------
// 복원은 "스냅샷 전체"가 아니라 "선언된 범위"만 대상으로 한다.
// 여기 정의된 테이블 목록이 복원 요청 범위의 유일한 정본이며,
// FK 종속으로 추가돼야 하는 테이블은 서버(public.backup_dependency_closure)가
// 계산해 자동 포함/차단으로 표면화한다. 임의 확장은 금지한다.
// ===========================================================================

export type RestoreScope =
  | "abd"
  | "abd_ocs"
  | "sm"
  | "tm"
  | "spl"
  | "spl_ocs"
  | "wrt"
  | "masters"
  | "permissions";

export const RESTORE_SCOPE_LABELS: Record<RestoreScope, string> = {
  abd: "ABD 원본·변경이력",
  abd_ocs: "ABD OCS(코멘트·첨부·이행)",
  sm: "Snag Management",
  tm: "Task Management",
  spl: "Spare Parts List",
  spl_ocs: "SPL OCS·문서",
  wrt: "Witness / Test Report",
  masters: "마스터·설정",
  permissions: "권한(RCL)·사용자 설정",
};

export const RESTORE_SCOPES: Record<RestoreScope, BackupTableName[]> = {
  abd: ["abd_items_raw", "abd_import_logs", "abd_change_log", "abd_comments", "abd_settings", "abd_import_presets"],
  abd_ocs: [
    "abd_ocs_import_logs",
    "abd_ocs_comment_groups",
    "abd_ocs_comments",
    "abd_ocs_comment_abd_links",
    "abd_ocs_compliance",
    "abd_ocs_compliance_log",
    "abd_ocs_attachments",
    "abd_ocs_attachment_comment_links",
    "abd_ocs_response_segments",
    "abd_ocs_response_comment_links",
    "abd_ocs_source_files",
    "abd_ocs_number_correction_log",
  ],
  sm: ["defect_items_raw", "defect_import_logs", "defect_status_history", "defect_comments"],
  tm: [
    "task_management_raw",
    "task_management_import_logs",
    "task_management_status_history",
    "task_schedule_change_audit",
    "task_comments",
  ],
  spl: ["spl_items", "spl_stage_catalog", "spl_stage_progress", "spl_change_log", "spl_import_logs", "spl_settings"],
  spl_ocs: [
    "spl_ocs_import_logs",
    "spl_rsp_items",
    "spl_ocs_comment_groups",
    "spl_ocs_comments",
    "spl_ocs_comment_spl_links",
    "spl_ocs_comment_rsp_links",
    "spl_ocs_categories",
    "spl_ocs_categories_mapping",
    "spl_ocs_attachments",
    "spl_ocs_attachment_comment_links",
    "spl_ocs_compliance",
    "spl_ocs_compliance_log",
    "spl_ocs_source_files",
    "spl_documents",
    "spl_document_item_links",
    "spl_document_pages",
    "spl_ocs_comment_document_links",
  ],
  wrt: ["wrt_items", "wrt_stage_catalog", "wrt_stage_progress", "wrt_change_log", "wrt_import_logs", "wrt_settings"],
  masters: [
    "team_master",
    "subcontractor_master",
    "dmr_contractor_master",
    "dmr_system_master",
    "defect_category_team_map",
    "hdec_eng_name_master",
    "hdec_pic_name_master",
    "abd_field_config",
    "defect_field_config",
    "task_management_field_config",
    "abd_header_mappings",
    "defect_header_mappings",
    "task_management_header_mappings",
    "task_management_settings",
    "tm_milestone_config",
    "tm_milestone_kinds",
    "defect_hdec_pic_rules",
    "defect_subcon_rules",
    "defect_import_presets",
  ],
  permissions: [
    "rcl_permissions",
    "rcl_module_config",
    "rcl_permissions_audit",
    "rcl_module_config_audit",
    "user_view_preferences",
    "tm_alarm_settings",
  ],
};

export const RESTORE_SCOPE_KEYS = Object.keys(RESTORE_SCOPES) as RestoreScope[];

/** 범위 키를 요청 테이블 목록으로 해석한다. 범위 밖 테이블 지정은 허용하지 않는다. */
export function resolveRestoreScope(scope: string): BackupTableName[] {
  const tables = RESTORE_SCOPES[scope as RestoreScope];
  if (!tables) throw new Error(`알 수 없는 복원 범위입니다: ${scope}`);
  return tables;
}

