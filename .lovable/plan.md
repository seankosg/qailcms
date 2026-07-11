## 목표
SHAW PROJECT CMS의 Defect Import Log 기능(배치 상세 · 행/필드 로그 · Rollback preview + 실행 + Force · Delete batch)을 본 프로젝트의 **모든 Import Log 화면(Spare Part / Task Management)** 에 동일하게 적용.

## 현재 상태 vs SHAW
| 항목 | SHAW (Defect) | 현재 프로젝트 |
|---|---|---|
| Import 로그 테이블 | `defect_upload_batches` | `spare_parts_import_logs`, `task_management_import_logs` ✅ |
| 데이터 → 배치 연결 | `defect_items.source_upload_id` | ❌ 없음 |
| Row 로그 | `defect_upload_row_logs` | ❌ 없음 |
| 필드 변경 로그 | `defect_change_log`, `import_field_logs` | `task_management_status_history`(부분), spare_part는 ❌ |
| Soft delete 컬럼 | `defect_items.is_active` | `spare_parts_raw.is_active` ✅, `task_management_raw` ❌ |
| Rollback status | `upload_status` enum + `rolled_back_at/by/force/note` | ❌ |
| Preview / Rollback / Delete RPC | ✅ | ❌ |
| Import Logs UI | 상세 화면 + Rollback/Delete 버튼 | placeholder 뿐 |

## 스코프
- Spare Part Import Log에 SHAW와 동일한 배치 리스트 · 상세 · Rollback · Delete
- Task Management Import Log에 동일 기능
- 두 모듈이 재사용하는 공통 `RollbackDialog` (kind: `"spare_part" | "task_management"`)

## DB 마이그레이션 (승인 후 1건으로 실행)

### 1) 공통 enum + 로그 컬럼
```
CREATE TYPE public.import_batch_status AS ENUM
  ('pending','processing','success','failed','rolled_back');
```
`spare_parts_import_logs`, `task_management_import_logs`에 다음 컬럼 추가:
- `rolled_back_at timestamptz`, `rolled_back_by uuid`, `rollback_force bool default false`, `note text`
- status 컬럼을 위 enum으로 마이그레이션

### 2) 데이터 행 ↔ 배치 연결
- `spare_parts_raw.source_import_log_id uuid`
- `task_management_raw.source_import_log_id uuid`, `task_management_raw.is_active bool default true`
  (index 및 부분 index 추가)

### 3) Row 로그 테이블 (2개)
- `spare_part_import_row_logs(id, upload_id, raw_row_no, doc_ref, action_taken, reason_code, reason_detail, processed_at)`
- `task_management_import_row_logs(id, upload_id, raw_row_no, discipline, task_no, action_taken, reason_code, reason_detail, processed_at)`

action_taken: `inserted|updated|skipped|rejected`.
RLS: authenticated select, admin insert/delete + GRANT.

### 4) 필드 변경 로그
- Spare Part: 새 테이블 `spare_part_change_log(id, doc_ref, changed_field, old_value, new_value, change_source, upload_id, changed_by, changed_at)` + trigger로 UPDATE시 자동 기록.
- Task Management: 기존 `task_management_status_history` 활용 + `upload_id uuid` 컬럼 추가, `source='excel_import'` 값 유지.
RLS + GRANT 동일.

### 5) RPC 8개 (SHAW의 defect 함수와 동일 구조)
`preview_rollback_spare_part_import` / `rollback_spare_part_import`
`preview_rollback_task_management_import` / `rollback_task_management_import`
`delete_spare_part_import_batch` / `delete_task_management_import_batch`
+ 각 preview는 `{insert_count, update_count, conflict_count, conflicts}` 반환
+ 각 rollback은 `{restored_count, deleted_count, skipped_count}` 반환, `_force` 파라미터 지원
+ 권한 `has_role(uid,'admin') OR has_role(uid,'superuser')`

Rollback 로직 (SHAW 그대로 이식):
1. 이 배치가 만든 UPDATE를 change_log에서 역으로 원상복귀. 이후 다른 소스가 같은 필드를 또 바꿨으면 conflict → `_force=false`면 skip
2. 이 배치가 INSERT한 행(`source_import_log_id = _batch_id`) soft-delete (`is_active=false`)
3. 이 배치의 row 로그·change_log 유지 (감사용)
4. 배치 status를 `rolled_back`으로 갱신 + `rolled_back_at/by/force/note`

Task Management의 경우 rollback 후 영향 받은 parent에 대해 `update_task_summary()` 자동 재롤업.

## Import 컨텍스트 수정 (기존 파일)
`SparePartImportContext.tsx`, `TaskManagementImportContext.tsx`:
- 각 행 upsert 시 `source_import_log_id`를 함께 저장 (신규 insert 감지: doc_ref/task_no가 이미 존재하지 않을 때만 세팅)
- 실행 결과에 따라 `spare_part_import_row_logs` / `task_management_import_row_logs`에 action별 로그 bulk insert
- 완료 시 import log의 status를 새 enum 값으로 갱신

## 프론트엔드

### 1) 공통 컴포넌트
`src/components/import/RollbackDialog.tsx` — SHAW 파일을 kind만 `"spare_part" | "task_management"`로 매핑해 그대로 이식.
`src/lib/import/fetchAllByUploadId.ts` — SHAW의 pagination helper 포팅.

### 2) Spare Part Import Logs
`src/routes/_authenticated/closure/spare-part/import.logs.tsx` (기존 placeholder 교체)
- 배치 리스트: File / Type("Spare Part") / Date / Uploader / Data Date / Duration / Status / Total / Inserted / Updated / Skipped / Rejected
- Status 뱃지: success/processing/pending/failed/`rolled_back`
- 관리자 행에 Rollback (Undo2) + Delete (Trash2) 버튼
- Row 클릭 시 상세 뷰: Tabs "Row Logs" + "Field Changes" (spare_part_change_log)
- Row Logs 필터/검색/renderLimit (SHAW와 동일 UX)

### 3) Task Management Import Logs
새 라우트 `src/routes/_authenticated/closure/task-management/import.logs.tsx` + AppLayout 사이드바에 링크 추가
- 위와 동일한 UI, discipline 컬럼 표시
- 상세 탭: "Row Logs" + "Status History" (`task_management_status_history`를 upload_id로 필터)

### 4) 서버 함수
`src/lib/import/rollback.functions.ts` — `requireSupabaseAuth` 미들웨어로 admin 검증 후 위 RPC 호출 (Rollback UI는 supabase client에서 RPC 직접 호출도 가능, SHAW와 동일하게 RLS 기반 유지).

## 검증
- 두 모듈 각각: import → preview (insert/update/conflict 카운트 확인) → rollback (`_force=false`) → 재조회하여 삽입 행 `is_active=false`, 업데이트 롤백, status `rolled_back` 확인
- Delete 시 원본 행/로그 하드 삭제 검증
- `tsgo` 및 build:dev 통과

## 스코프 밖
- 다른 모듈 (없음). Aconex sync log는 이번 범위 아님.
- 감사 hard-delete는 SHAW와 동일하게 Rollback 시 수행하지 않음 (row_logs 유지)
