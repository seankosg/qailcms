# Backup & Restore

## 스케줄

- **자동**: 매일 도하 23:50 (cron `50 20 * * *` UTC).
- **수동**: Admin > Backup 페이지 "지금 실행" 버튼.
- **임포트 전 자동 스냅샷**: 각 모듈 임포트 apply 직전 관련 테이블만 스냅.

## 대상 테이블 (`BACKUP_TABLES`)

### Raw Data
`abd_items_raw`, `defect_items_raw`, `task_management_raw`, `spare_parts_raw`, `dmr_entries`

### 사용자 / 마스터
`profiles`, `user_roles`, `team_master`, `subcontractor_master`, `dmr_contractor_master`, `dmr_system_master`, `defect_category_team_map`

### 모듈 설정
`task_management_settings`, `spare_part_status_mapping`, `abd_settings`,
`abd_field_config`, `defect_field_config`, `task_management_field_config`, `spare_part_field_config`,
`abd_header_mappings`, `defect_header_mappings`, `task_management_header_mappings`, `spare_part_header_mappings`,
`abd_import_presets`

### 임포트 / 변경 로그
`abd_import_logs`, `defect_import_logs`, `task_management_import_logs`, `spare_parts_import_logs`,
`abd_change_log`, `task_schedule_change_audit`

### 댓글
`abd_comments` (그 외 모듈 댓글은 필요 시 확장)

## 저장소

- Supabase Storage 버킷: `db-backups`.
- 대용량 raw 테이블은 10,000행 단위 분할 (`ROWS_PER_PART`).
- 각 파트별 SHA-256 무결성 체크.

## 복원 절차

1. Admin > Backup > 스냅샷 목록에서 대상 선택.
2. "복원" 버튼 → 확인 다이얼로그.
3. 대상 테이블 truncate 후 스냅샷 JSON 재삽입 (RLS 우회 트리거 처리).
4. 실패 시 `restore_run_log`에 오류 기록.

## Rollback (Import 단위)

`rollback_abd_import` / `rollback_defect_import` / `rollback_spare_part_import` / `rollback_task_management_import`
RPC를 통해 특정 import batch만 취소 가능. 임포트 로그 페이지에서 batch 선택 → "미리보기 → 롤백".

## 정리 (Retention)

`cleanupOldSnapshots` — Admin > Backup 페이지의 보존일수 설정에 따라 오래된 스냅샷 자동 삭제.
`lockSnapshot`으로 잠근 스냅샷은 정리 대상 제외.