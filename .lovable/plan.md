# Defect/Task 상세페이지 필드 편집 기능 정비

## 요약
현재 상세페이지는 이미 `isAdmin && column.editable && editorType` 조건으로 인라인 편집 팝오버를 제공하지만, 다음이 부족합니다:
- 편집 가능 필드 커버리지: Defect 19/45, Task 15/32 — Admin에게도 편집 불가한 필드가 다수
- 비관리자 UX: 편집 불가 사유 표시 없음, 잠긴 필드(`priority_locked`, `hdec_verification_locked`)에 대한 잠금 해제 UI 없음
- 상단 배지: 사용자 권한 상태(편집 가능/읽기 전용) 시각 표시 없음
- 편집 후 이력(Status History) 자동 새로고침 누락

사용자 답변대로 **Admin/Superuser만 편집**, 나머지 사용자는 읽기 전용으로 통일합니다. (SHAW의 scope(assigned/team/full) 로직은 별도 백엔드 RPC가 필요하므로 이번 스코프에서 제외 — 추후 요청 시 별도 마이그레이션으로 이관 가능함을 별도 보고.)

## 1. 컬럼 정의 확장 (`editable` 커버리지)

### `src/lib/defect-management/columns.ts` — 편집 가능 필드 추가
- Identity/Status: `source_issue_no`, `subcontractor_issue_no`, `status_raw`, `status_manual`, `completion_status`, `closure_status`
- Classification/Trade: `main_trade`, `sub_trade`, `trade_detail`, `work_type`, `area_type`, `area_level`, `area_location`
- People: `subcontractor_name`, `subsub_name`, `hdec_pic_name`, `hdec_eng_name`
- Dates: `planned_start_date`, `planned_completion_date`, `planned_closure_date`, `actual_start_date`, `actual_completion_date`, `actual_closure_date`
- Progress: `actual_progress_pct`, `planned_progress_pct`
- Content: `description`, `remarks`, `hdec_reason`
- (읽기전용 유지) `id`, `created_at`, `updated_at`, `updated_by`, `is_active`, `priority_locked`, `hdec_verification_locked`, 파생/롤업 필드

### `src/lib/task-management/columns.ts` — 동일하게 확장
- Task/Plan/Actual/Forecast의 사용자 편집 가능 필드에 `editable: true` + `editorType` 지정
- 롤업/자동계산 필드는 편집 불가 유지: `plan_progress`, `slip_days`, `auto_judgment`, `progress_variance`, `plan_days`, `actual_duration`, `is_rollup` 등

## 2. 상세페이지 편집 UX 개선

### `DefectDetailPage.tsx`, `TaskDetailPage.tsx` 공통
- **헤더 우측 배지 추가**: `isAdmin` → "편집 가능" (녹색), 아니면 "읽기 전용" (회색)
- **필드 hover 툴팁**:
  - Admin + editable → "클릭하여 편집" (기존)
  - Admin + editable + locked → "잠긴 필드 · 잠금 해제 필요"
  - 비관리자 + editable → "관리자만 편집 가능"
- **잠금 해제 액션** (Defect 전용): `priority`, `hdec_verification` 필드 옆에 Admin인 경우 잠금 배지 클릭 시 unlock 팝오버 (사유 입력 → `priority_locked=false` 업데이트)
- **저장 후 리프레시**: `EditCellPopover.onSaved`에서 `refetch()` + 상태이력 쿼리 invalidate (`queryClient.invalidateQueries({ queryKey: ["defect-status-history", id] })`)

### `EditCellPopover.tsx` 개선 (Defect)
- `date` 편집 시 빈 문자열 → `null`로 정확히 전달 (현재도 동작하나 검증)
- `select` 필드에서 `null`/"" 선택 옵션 지원 (빈값 지우기)
- 잠긴 필드 클릭 시 팝오버 대신 잠금 안내 툴팁

## 3. 서버 함수: 권한 재검증

이미 `updateDefectField`/`updateTaskField`가 `requireSupabaseAuth` 미들웨어를 통과합니다. Admin 검증을 handler 상단에 추가:
```ts
const { data: isAdmin } = await context.supabase
  .rpc("has_role", { _user_id: context.userId, _role: "admin" });
const { data: isSuper } = await context.supabase
  .rpc("has_role", { _user_id: context.userId, _role: "superuser" });
if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 편집할 수 있습니다");
```
- `src/lib/defect-management/mutations.functions.ts`: `updateDefectField`, `bulkUpdateDefects`, `bulkToggleCritical` 모두 동일 가드
- `src/lib/task-management/bulk-actions.ts` (updateTaskField 포함): 동일 가드

DB 레벨에서는 이미 RLS가 관리자만 UPDATE 허용하도록 되어 있다고 가정 (별도 스캔 필요 없음 — RLS 정책 확인만 검토 후 부족 시 별도 마이그레이션).

## 4. 파일 변경 요약

**편집**
- `src/lib/defect-management/columns.ts` — `editable`/`editorType`/`options` 확장
- `src/lib/task-management/columns.ts` — 동일
- `src/components/defect-management/detail/DefectDetailPage.tsx` — 권한 배지, 리프레시 로직, 잠금 해제 UI
- `src/components/task-management/detail/TaskDetailPage.tsx` — 권한 배지, 리프레시 로직
- `src/components/defect-management/raw-data/EditCellPopover.tsx` — 비관리자 툴팁, 빈값 처리
- `src/components/task-management/raw-data/EditCellPopover.tsx` — 동일
- `src/lib/defect-management/mutations.functions.ts` — Admin 가드 명시적 추가
- `src/lib/task-management/bulk-actions.ts` — Admin 가드 명시적 추가

**신규**
- (없음)

## 별도 보고 (이번 스코프 외)
- SHAW의 세분화된 편집 스코프(`assigned` / `team` / `full`)는 백엔드 RPC(`get_defect_edit_scope`)와 profiles.subcontractor_name 매핑이 필요합니다. 협력사가 자기 team만 수정하는 정책이 필요하면 별도 마이그레이션으로 도입 가능.
- 편집 저장 실패 시 낙관적 UI 롤백은 현재 popover 재열기로 충분. 이번엔 손대지 않음.

승인해 주시면 컬럼 정의 확장부터 순차 반영하겠습니다.