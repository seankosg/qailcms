# ABD Raw Data — TM Bulk Edit 이식

TM Raw Data(TMRD)의 mass 편집 UX(선택 체크박스 + BulkEditBar + Bulk Confirm/Delete 다이얼로그 + Export/Copy TSV)를 ABD Raw Data에 그대로 이식합니다. UI 문구, 색상, 배치, 동작 흐름을 TMRD와 동일하게 유지합니다.

## 대상 UI (TMRD와 동일)

- 좌측 첫 번째 sticky 컬럼: 헤더/행에 체크박스(`__select`), sticky 처리 및 100% 불투명 배경 규칙 준수 (mem: sticky-columns-opaque).
- 툴바 우측 "Task 추가"류 버튼 옆에 `{n} selected` 뱃지 표시.
- 툴바 아래 `AbdBulkEditBar` (선택 시에만 표시):
  - Field select(그룹핑) → Value 입력(select/date/number/text) → Blank 토글 → Apply
  - Export(.xlsx / Copy TSV) 드롭다운
  - More 메뉴: Delete permanently / Clear selection
  - 진행 토스트, 500개 청크 배치 및 "batch i/N" 안내
- `BulkConfirmDialog` / `BulkDeleteDialog` (TMRD 그대로 재사용 컴포넌트를 ABD용으로 복제).

## Bulk 편집 가능 필드

`ABD_COLUMNS`에서 `editable && editorType` 인 컬럼을 자동 노출 (기존 인라인 편집과 동일 대상):

- Identity: Batch No.
- Content: Document Title, HDEC PIC, HDEC ENG
- Latest: Latest Rev, Latest Status(select A/B/C/UR/NOT YET/CX/TM), Approval(date)
- Round1/2/3 각 8개 날짜(DS/DF/Sub/DAR × Plan/Actual) + Response Result(A/B/C)

`isPercent` 필드 없음. 그룹 라벨은 `AbdGroupKey` → 한글/영문 라벨 매핑.

## 파일 변경

### 신규
- `src/lib/abd/bulk-actions.ts`
  - `applyAbdBulkUpdate({ ids, field, value })`: 100건 청크, `abd_items_raw` 직접 update, `{ attempted, succeeded, failed, errors }` 반환.
  - `applyAbdBulkHardDelete(ids)`: 200건 청크 delete.
  - `getAbdBulkEditableFields()`: `ABD_COLUMNS` → `BulkEditableField[]` (TM과 동형 인터페이스).
  - `exportRowsToXlsx`, `copyRowsAsTsv`: TM `bulk-actions.ts`와 동일 시그니처로 재작성 (styled-workbook 사용).
- `src/components/abd/raw-data/AbdBulkEditBar.tsx` — TM `BulkEditBar.tsx` 복사 후 import 경로/타입만 ABD용으로 치환. 문구/스타일 그대로.
- `src/components/abd/raw-data/dialogs/AbdBulkConfirmDialog.tsx` — TM `BulkConfirmDialog` 이식.
- `src/components/abd/raw-data/dialogs/AbdBulkDeleteDialog.tsx` — TM `BulkDeleteDialog` 이식 (DELETE 확인 문구 동일).

### 수정
- `src/components/abd/raw-data/AbdRawDataPage.tsx`
  - `rowSelection: RowSelectionState` state + `getRowId: (r) => String(r.id)` 추가.
  - `__select` 컬럼 ColumnDef 삽입(맨 왼쪽, sticky, size 36, enableResizing/Sorting false, 헤더는 현재 페이지 rows 기준 전체선택).
  - 툴바에 `{n} selected` 뱃지 + `AbdBulkEditBar` 렌더.
  - Sticky offset 계산에 `__select` 포함, 배경 불투명(디자인 메모 준수).
  - Export/TSV 컬럼 리스트에서 `__select` 제외.
  - Bulk 반영 후 `useInvalidateAbd()` 호출 + 선택 해제.

## 권한

- `canEditRawRow(currentUser)` (이미 사용 중) 결과를 `canEdit` prop으로 전달 → Apply/Delete 비활성화. RLS는 `abd_items_raw` 정책이 그대로 적용됨.

## 데이터/서버 계약

- 기존 `updateAbdField` server function은 단일 셀 편집용이므로 유지. Bulk update는 성능 위해 client-side chunked update(TM 동일 패턴)로 처리하고 `updated_at`도 함께 세팅. Latest Status/Response Result/날짜 변경 시 derived 트리거(`abd_compute_derived`)가 DB에서 이미 자동 재계산하므로 별도 처리 불필요.
- Delete는 hard delete (TM과 동일 정책). RLS로 권한 없는 사용자는 실패 → 토스트 노출.

## 검증

- 타입체크, ABD Raw Data 화면 진입 → 3~5행 선택 → 필드/값 지정/Apply 성공 토스트, DB 반영, 라운드 파생값 갱신 확인.
- 5000행 이상 대량 필터 후 Bulk Edit(500 청크) 시 진행 토스트/부분실패 리포트 확인.
- Delete permanently 시 "DELETE" 타이핑 게이트, 삭제 후 목록 갱신 확인.
- Export .xlsx / Copy TSV 결과가 현재 표시 컬럼과 일치.
- Sticky 첫 컬럼(체크박스) 배경 불투명 유지 (Raw Data 스크롤 시 뒤 컬럼 비침 없음).
