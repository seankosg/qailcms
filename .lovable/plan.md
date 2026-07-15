# ABD 임포트: 필드 mismatch 폐기 + 중복 검증

## 목표
- `ABD_NUMBER` 재파싱으로 세그먼트를 덮어쓰던 로직과 `field_mismatch` 경고를 완전히 폐기.
- 엑셀 원본 셀값을 그대로 저장.
- 임포트 전에 파일 내 `ABD_NUMBER` 중복을 검출해 사용자에게 상세히 노출하고 임포트 차단.

## 변경 사항

### 1. Parser (`src/lib/abd/parser.ts`)
- `parseAbdNumber()` 호출 및 `mismatch` 계산 블록 제거.
- 각 행의 값은 **엑셀 셀값 그대로** 사용:
  - `dis` ← 원본 `DIS`
  - `doc_ax / doc_axx / doc_nn1 / doc_n / doc_nn2` ← 원본 `AX / AXX / NN / N / NN`
  - `plot` ← 시트명 감지만 유지 (`ABD Plot 3` → `C`, `ABD Plot 4` → `D`)
  - `abd_number` ← 원본 문자열 trim
- `ParsedAbdRow` 에서 `field_mismatch`, `mismatch_fields` 제거.
- **파일 내 중복 검출**: 시트를 가로질러 `ABD_NUMBER` 를 집계, 2회 이상 등장하면
  ```
  duplicates_in_file: Array<{
    abd_number: string,
    occurrences: Array<{ sheet_name: string, excel_row: number, sl_no: number|null, document_title: string|null }>
  }>
  ```
  형태로 `ParsedFileResult` 에 포함.

### 2. Mutation (`src/lib/abd/mutations.functions.ts`)
- insert/update 페이로드에서 `field_mismatch`, `mismatch_fields` 제거.
- 서버측에서도 파일 내 중복 방어: 배치 시작 시 `rows` 내 중복 있으면 400 반환 (UI 에서 이미 차단하지만 이중 안전장치).

### 3. Import UI (`src/components/abd/import/AbdImportPage.tsx`)
- 각 파일 카드 하단에 표시:
  - 기존 "필드 mismatch NNN행" 경고 삭제.
  - 중복이 없을 때: 표시 없음.
  - 중복이 있을 때:
    - 빨간 배지 "중복 N건 — 임포트 차단"
    - `Start import` 버튼 비활성화 (파일 단위. 다른 파일은 정상 진행 가능).
    - "중복 상세 보기" 링크 → 다이얼로그 오픈.
- **중복 상세 다이얼로그** (`AbdDuplicateReviewDialog.tsx` 신규):
  - 표 형태: `ABD_NUMBER`, `시트명`, `엑셀 행번호`, `Sl.No`, `Document Title`.
  - 같은 `ABD_NUMBER` 는 그룹핑해서 나란히 표시.
  - 하단: 
    - `Copy to clipboard` 버튼 (TSV 로 복사 → 엑셀 붙여넣기 가능).
    - `Download CSV` 버튼.
    - 안내 문구 "원본 엑셀에서 중복 행을 수정한 뒤 다시 업로드하세요."
  - 임포트 강행 옵션은 **제공하지 않음** (사용자 요구사항).
- 상단 안내 알림에서 mismatch 관련 문구 삭제, 중복 검증 규칙 문구 추가:
  - "동일 ABD_NUMBER 가 파일 내에 2회 이상 있으면 임포트가 차단됩니다. 원본에서 수정 후 재업로드하세요."

### 4. Raw Data / Detail
- `ABD_COLUMNS` 에서 `field_mismatch` 컬럼 항목 삭제.
- `AbdRawDataPage.tsx`, `AbdColumnFilterDropdowns.tsx`, `AbdDetailSheet.tsx`, `AbdExportDialog.tsx` 에서 mismatch 관련 UI/필터/컬럼 제거.

### 5. DB
- 컬럼 drop 은 하지 않고 값만 초기화(안전 롤백 여지):
  ```sql
  UPDATE public.abd_items_raw
     SET field_mismatch = false, mismatch_fields = NULL
   WHERE field_mismatch = true OR mismatch_fields IS NOT NULL;
  ```
- `abd_items_raw` 에 UNIQUE(`abd_number`) 제약이 이미 있으면 유지, 없으면 이번 마이그레이션에 추가 (upsert 키 명확화). 실제 스키마 확인 후 반영.

## 검증
- `bunx tsgo --noEmit` 통과.
- 첨부 파일 재업로드 시:
  - 노란 mismatch 경고가 사라짐.
  - 파일 내 실제 중복 행이 있으면 빨간 차단 배지 + 상세 다이얼로그에서 정확한 시트/행/ABD_NUMBER 확인 가능.
  - 중복이 없으면 `Start import` 활성, 진행 시 `AXX="000"` 등 원본값 그대로 저장.
- DB 기존 행은 upsert 로 갱신, 없던 행은 insert.

## 비변경
- 시트 무시 규칙(`Bar chart`, `Subcon`, `Sheet*`)과 헤더 자동 인식은 그대로.
- Plot 자동 감지(시트명 기반)는 유지.
- Inactive 처리(이번 파일에 없는 도면 비활성화)는 그대로 유지.
