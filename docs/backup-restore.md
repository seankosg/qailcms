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
## 안전 복원 — Holding Point 2 (사전검증·준비 영역까지)

기존 복원 실행 경로는 여전히 차단 상태(`LEGACY_RESTORE_DISABLED`)이며, 아래 경로는 **운영 테이블을 변경하지 않는다.**

### 복원 범위 계약
`src/lib/backup/backup-shared.ts` 의 `RESTORE_SCOPES` 가 유일한 정본이다.
범위: `abd`, `abd_ocs`, `sm`, `tm`, `spl`, `spl_ocs`, `wrt`, `masters`, `permissions`.
범위 밖 테이블 지정은 허용하지 않는다(`resolveRestoreScope` 가 거부).

### 읽기 전용 DB 함수 (service_role 전용)
- `backup_dependency_closure(_requested, _snapshot_tables)` — FK 하위 종속 전이 폐쇄, 자동 포함 테이블, 현재 값 유지 부모 테이블, `insert_order`/`remove_order`, 순환 참조, 차단 사유.
- `backup_table_schema_contract(_tables)` — 컬럼/PK/FK/UNIQUE + 테이블 단위 `schema_digest`.
- `backup_schema_fingerprint(_tables)` — 위 digest 를 합친 지문.
- `restore_staging_verify(_run_id)` — 준비 영역 행수/미지 컬럼/PK NULL·중복/NOT NULL/UNIQUE 중복/FK 고아 검산.

### 스냅샷 규격 v2
신규 스냅샷 매니페스트에 `schema_version: "qail-snapshot-v2"`, `schema_fingerprint`, `schema_contract` 를 기록한다.
v2 미만(레거시) 스냅샷은 사전검증에서 `SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED` 로 차단된다.

### Preflight 차단 코드
`MANIFEST_MISSING`, `SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED`, `TABLE_NOT_IN_WHITELIST`,
`DEPENDENT_TABLE_NOT_WHITELISTED`, `REQUIRED_TABLE_MISSING_IN_SNAPSHOT`, `FK_CYCLE_DETECTED`,
`SCHEMA_CHANGED_SINCE_SNAPSHOT`, `TABLE_MISSING_IN_MANIFEST`, `PART_HASH_UNAVAILABLE`,
`PART_FILE_MISSING`, `PART_HASH_MISMATCH`, `PART_ROW_COUNT_MISMATCH`, `PART_PARSE_FAILED`,
`TABLE_ROW_COUNT_MISMATCH`.
차단이 하나라도 있으면 준비 영역 적재로 넘어갈 수 없다.

### Staging
`restore_runs`(작업 상태) + `restore_staging_rows`(백업 행 임시 적재).
`stageRestoreRun` 은 `preflight_clean` 상태에서만 동작하고, 파트별 해시를 재검증한 뒤 준비 영역에만 INSERT 한다.
적재 후 `restore_staging_verify` 를 실행해 `staging_verified` 또는 `failed` 로 마감한다.

### 서버 함수 (Admin 전용)
`listRestoreScopes`, `previewSafeRestore`(읽기), `startRestorePreflight`(System Administrator),
`stageRestoreRun`(System Administrator), `verifyRestoreStaging`, `listRestoreRuns`.

### 남은 차단 사항 (사용자 결정 필요)
백업 화이트리스트에 없는 종속 테이블이 있어 다음 범위는 현재 사전검증에서 차단된다:
- `abd` — `abd_audit_log`, `abd_import_row_logs`, `abd_mf_change_log`
- `tm` — `task_management_import_row_logs`, `tm_pic_delegations`
- `spl` — `spl_import_row_logs`
- `wrt` — `wrt_import_row_logs`
- `masters` — `tm_pic_delegations`
