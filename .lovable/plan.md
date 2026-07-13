# Raw Data 선택 항목 영구삭제 기능 구현 계획

현재 Defect Raw Data 페이지의 Bulk Bar에는 일괄 편집/Critical 토글/Export/TSV 복사만 있고 삭제 기능이 없습니다. 관리자가 선택한 행을 **영구 삭제(hard delete)** 할 수 있는 기능을 추가합니다.

## 정책

- **권한:** admin / superuser 만 실행 가능 (`is_admin_or_super`).
- **삭제 범위:** `defect_items_raw` 물리 삭제 (soft delete `is_active=false` 가 아니라 완전 삭제). 사용자가 "영구삭제"를 명시했으므로 hard delete.
- **부수 데이터 처리:** 해당 defect id 의 `defect_status_history` 도 함께 삭제 (FK cascade 확인 후 필요 시 명시적 삭제).
- **감사 로그:** 삭제 이력을 남기기 위해 `defect_import_row_logs` 대신 별도 처리 없이 서버 함수 내부에서 로그성 이력만 남김 (테이블 신설은 스코프 밖). 필요 시 후속.
- **탭 무관:** Unclosed / Closed 양 탭 모두에서 삭제 가능.
- **일괄:** 500 건 단위 chunk 로 처리하여 25만행 규모에서도 안전.

## 서버 함수 (신규)

`src/lib/defect-management/mutations.functions.ts` 에 `bulkDeleteDefects` 추가:

- 입력: `{ ids: string[] (1~5000) }`.
- 처리 순서:
  1. `requireSupabaseAuth` + `assertAdmin` (기존 로직 재사용).
  2. `defect_status_history` 에서 `defect_raw_id in ids` 삭제.
  3. `defect_items_raw` 에서 `id in ids` 삭제.
- 반환: `{ ok, count }`.

## UI 변경

`src/components/defect-management/raw-data/BulkEditBar.tsx`:

- 우측 `MoreHorizontal` 드롭다운 메뉴에 **"선택 항목 영구삭제"** 항목 추가 (destructive 스타일, 관리자 권한이 없으면 disabled).
- 클릭 시 `AlertDialog` 열림:
  - 제목: "선택한 N건을 영구 삭제하시겠습니까?"
  - 본문: "이 작업은 되돌릴 수 없습니다. 삭제된 데이터는 복구할 수 없습니다." + 확인 입력 필드 (`DELETE` 를 입력해야 버튼 활성화).
  - 확인 버튼 클릭 시 chunk 500 씩 `bulkDeleteDefects` 호출, 진행률 toast 표시.
- 성공 시 `onApplied()` 로 `["defect"]` query 무효화 및 selection clear, 실패 시 toast error.

## 캐시/URL

- 성공 후 `queryClient.invalidateQueries({ queryKey: ["defect"] })` (기존 `onApplied` 흐름 재사용) — 탭 카운트/리스트가 즉시 갱신됨.
- URL selection 상태는 clear.

## 기술 세부

- **파일 변경:**
  - 수정: `src/lib/defect-management/mutations.functions.ts` — `bulkDeleteDefects` export 추가.
  - 수정: `src/components/defect-management/raw-data/BulkEditBar.tsx` — 삭제 메뉴 항목, 확인 다이얼로그, chunk 실행 로직.
- **DB 마이그레이션 필요 여부:** 없음. 현재 `defect_status_history.defect_raw_id` FK 가 `ON DELETE CASCADE` 인지 확인 후, cascade 가 아니면 서버 함수에서 명시 삭제 (계획대로).
- **에러 처리:** 각 chunk 단위 실패 시 지금까지 삭제된 건수 riportare + 이후 중단.

## 결정 필요

1. **Soft delete vs Hard delete** — 사용자가 "영구삭제"라 명시했으므로 hard delete 로 진행 예정 (이 방향 승인 여부).
2. **권한** — admin/superuser 만 (일반 사용자 노출 X). 확인.
3. **확인 방식** — `DELETE` 텍스트 재입력을 필수로 두는지 (실수 방지). 계획은 필수.
