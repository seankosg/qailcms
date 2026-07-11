## 목표

Spare Part Raw Data 화면의 선택-행 mass 변경 UX를 SHAW PROJECT CMS와 동일한 수준으로 끌어올립니다. 사용자 답변에 따라 3가지 기능만 이식하고, 나머지(Soft Delete / Reassign / Duplicate / change_log)는 제외합니다.

## 포함 범위

1. **Bulk Edit** — SHAW의 `BulkActionBar` 상단 바를 그대로 이식
   - "N selected · Editable K · Will run in X batches of 500" 상태 표시
   - 그룹별 필드 피커(Select) + 입력 컨트롤(select / date / text / textarea / boolean / number)
   - Blank 체크박스로 값 clear (`null` 저장)
   - Apply → 상위 5행 before → after 미리보기 확인 다이얼로그
   - 500행 단위 auto-chunk + batch 진행 토스트
   - 변경 이력 로그 없음 (단순 update)
   - 관리자만 편집 가능(`canEdit`)

2. **Hard Delete** — SHAW의 `BulkDeleteDialog`(hard 모드)만 이식
   - `spare_parts_raw`에서 선택된 `doc_ref` 완전 삭제
   - Cascade 미리보기: `spare_part_comments`, `spare_part_status_history`, `spare_part_custom_fields`의 관련 행 개수 표시
   - "DELETE" 타이핑으로 확인
   - 200행 chunk, 관련 자식 테이블 먼저 삭제 후 raw 삭제

3. **Export(선택 행)** — SHAW의 Export 드롭다운 이식
   - `.xlsx` 다운로드: 사용자가 화면에서 보고 있는 컬럼 순서/라벨 그대로
   - TSV 클립보드 복사: 헤더 + 값 tab-separated

## 편집 가능 필드 확장

`SPARE_PART_COLUMNS`의 그룹(`id/approval/vendor/qty/cost/delivery/avail/spl/stage/issue/remark`)을 그대로 활용하여, `doc_ref`와 자동 계산되는 progress 컬럼을 제외한 대부분(약 40개)을 그룹별 필드 피커에 노출합니다.

컬럼 타입 → 입력 컨트롤 매핑:
- `boolean` → boolean 셀렉트(Yes/No/Blank)
- `date` → date input
- `number` / `cost` → number input
- `badge`(`approval_code`, `plot`) → 옵션 select
- 나머지 `text` → text input, `remarks/action/proc_remarks` 같은 긴 값은 textarea popover

Progress 계열(`rfq_progress`, `quotation_progress`, `po_progress`, `delivery_progress`)과 감사 컬럼(`updated_at`, `created_at`, `is_active`는 별도 필터로 관리 중)은 편집 목록에서 제외합니다.

## 기술 설계

### 파일 구조 (신규/수정)

```
src/lib/spare-part/
  bulk-edit.ts               (신규) BulkEditableField 타입, applyBulkUpdate, chunkArray, BULK_CHUNK_ROWS
  bulk-actions.ts            (신규) applyBulkDelete(hard), previewBulkDelete, exportSelectedToXlsx, copyRowsAsTsv
  columns.ts                 (수정) BULK_EDITABLE_FIELDS 대체 → getBulkEditableFields() 그룹별 정의 반환

src/components/spare-part/raw-data/
  BulkEditBar.tsx            (전면 교체) SHAW BulkActionBar 스타일로 재작성. sticky top 바.
  dialogs/
    BulkDeleteDialog.tsx     (신규) hard-only 버전
    BulkConfirmDialog.tsx    (신규) Apply 전 before/after 미리보기

  SparePartRawDataPage.tsx   (수정) BulkEditBar props 확장, refetch 후크 연결
```

### applyBulkUpdate 시그니처

```ts
type BulkUpdateRequest = {
  ids: string[];               // doc_ref 값 배열
  field: string;               // 컬럼명
  value: string | number | boolean | null;
  extraUpdates?: Record<string, string | number | boolean | null>;
};
```

- PK 컬럼은 `doc_ref` 고정(spare_parts_raw)
- 100행 chunk로 `.update(...).in('doc_ref', chunk).select('doc_ref')` 반복
- 반환: `{ attempted, succeeded, failed, errors }`
- 로그/diff 없음 — SHAW의 change_log 관련 코드는 이식하지 않음

### applyBulkDelete (hard)

- `spare_part_comments`, `spare_part_status_history`, `spare_part_custom_fields`에서 `doc_ref IN (...)` 먼저 삭제
- 이어서 `spare_parts_raw.delete().in('doc_ref', chunk)` 실행
- chunk 200개
- previewBulkDelete는 3개 자식 테이블 각각 `count: 'exact', head: true`로 개수만 조회

### Export

- `exportSelectedToXlsx({ rows, columns, fileName })` — 기존 `excel-export.ts`가 있으니 그 유틸을 재사용하거나 `xlsx` 패키지로 직접 workbook 생성
- `copyRowsAsTsv({ rows, columns })` — `navigator.clipboard.writeText`로 TSV 문자열 복사
- `columns`는 SparePartRawDataPage에서 현재 표시 순서·라벨 그대로 전달(`table.getVisibleLeafColumns()` → key/label 매핑)

### 상단 바 위치

현재 BulkEditBar는 sticky bottom. SHAW와 동일한 UX를 위해 **sticky top**으로 옮기고, 좌측에 primary 컬러 바(border-l-2)로 강조합니다.

### 권한

- `canEdit = currentUser.isAdmin`만 사용(SHAW의 per-row scope RPC는 이식하지 않음)
- 관리자 아닌 사용자에게는 selected count만 보이고 Apply/Delete 버튼은 disabled

## 마이그레이션

DB 변경 없음. change_log 테이블 미생성.

## 수용 기준

- 여러 행 선택 후 Bulk Edit 바에서 그룹별 필드 선택 → 입력 → Apply → 확인 다이얼로그의 상위 5개 행에 이전값/변경값이 나타남 → 확인 시 500행씩 batch로 반영되고 batch 진행 토스트 표시
- Blank 체크박스 사용 시 실제 DB에 `NULL`이 저장됨
- More → Delete permanently → cascade 미리보기(comments / status_history / custom_fields 건수) + "DELETE" 타이핑 후 확인 시 자식 테이블 → raw 순으로 삭제되고, 리스트에서 사라짐
- Export 드롭다운에서 xlsx 다운로드 및 TSV 클립보드 복사 모두 동작. 컬럼 순서·라벨은 현재 화면과 일치
- 관리자 아닌 사용자에게는 Apply/Delete 비활성화