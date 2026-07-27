# ABD Import — 로그 중복 · 진도율 정지 원인 및 수정 계획

## 원인 분석 (확인된 사실)

### 1) 로그 2건 발생 — "시트별 로그" 구조가 근본 원인
- `AbdImportPage.startImport()` (src/components/abd/import/AbdImportPage.tsx:427-450)에서 파일을 **시트 단위로 순회**하며 각 시트마다 `importAbdBatch()`를 별도 호출.
- `importAbdBatch` (src/lib/abd/mutations.functions.ts:179-192)는 호출될 때마다 **`abd_import_logs` 행을 새로 INSERT**함.
- ABD Status_ELEC_260727.xlsx는 "ABD Plot 3", "ABD Plot 4" 두 시트를 가지므로 → 로그 2행 생성.
- DB 확인: 어제 260726 파일도 동일한 패턴으로 Plot 3 / Plot 4 로그가 각각 존재 (started_at 2건 확인).

### 2) "총 갯수가 틀림"
- Import Logs 테이블은 각 로그 행의 `total_rows`(=해당 시트 행수)를 그대로 표시.
- 사용자는 "파일 1건 = 총합"으로 인식하는데 화면은 시트별로 쪼개진 숫자를 보여줌.

### 3) 진도율 바가 중간에 멈춤
- `startImport()`의 진행률 갱신 로직은 단 두 지점: 시작 시 `progress: 20`, 전체 시트 완료 후 `progress: 100`.
- 시트 루프 안에서는 진행률을 갱신하지 않음 → 시트 1이 처리되는 동안(2,000행 upsert + row-log/field-log flush) 20%에서 정지 상태로 보임.
- Aconex 스냅샷 + 대용량 upsert가 겹치면 수 분 대기가 발생.
- 사용자가 "새로 고침"하면 DB에는 이미 status='success'로 finalize되어 있어 완료로 보임.

## 수정 방향

### A. 파일당 로그 1건 (핵심)
- `importAbdBatch` 서명에 `sheets` 배열 파라미터 추가 (하위 호환 위해 기존 `rows`도 유지).
- 서버 핸들러:
  1. `abd_import_logs`에 **한 번만** INSERT (plot=null 또는 "MULTI", sheet_name=null, total_rows=Σ)
  2. 시트별 payload를 **동일 batchId**로 순차 upsert
  3. `inactivate_missing`은 **team 단위로 한 번만** 수행 (현재 시트별 반복 시 뒤 시트가 앞 시트 데이터를 비활성화하는 잠재 버그도 함께 해소됨)
  4. 마지막에 하나의 log 행에 집계 결과 UPDATE
- 클라이언트 `startImport`: `for sheet ...` 루프 제거, 시트 배열을 한 번에 전달.

### B. 진행률 서버 콜백
- 서버는 단일 호출이므로 클라이언트에서 세밀한 progress를 받기 어려움. 대신:
  1. 클라이언트에서 **시트별로 서버 호출**하되(단일 batchId를 첫 호출에 생성해 반환, 이후 호출은 append 모드) 각 호출 완료마다 `progress = round((done/total)*80) + 10`으로 갱신.
  2. 또는 위 A 통합 호출 + 클라이언트 예상 진행률(예: 파일 크기·행수에 기반한 부드러운 애니메이션) 대체.
- 채택: **A + append 모드**. `importAbdBatch({ log_id?, sheet_index, total_sheets, rows, ...finalize? })` 형태.
  - `log_id`가 없으면 새 로그 생성 및 반환.
  - `finalize=true`인 마지막 호출에서만 inactivate_missing 수행 및 status='success' 마감.
  - 클라이언트는 시트마다 호출하며 진행률 UI 갱신.

### C. Import Logs 화면 표시 개선(경미)
- 파일당 그룹핑(collapsible)까지는 이번 스코프 외로 두고, 우선 로그가 1건만 남게 하는 것으로 사용자 불편 해소.

## 기술 세부 (변경 파일)

- **src/lib/abd/mutations.functions.ts**
  - `ImportBatchSchema`에 `log_id?: uuid`, `sheet_index?: number`, `total_sheets?: number`, `finalize?: boolean`, `all_sheet_numbers?: string[]` 추가.
  - handler:
    - `log_id`가 있으면 재사용, 없으면 INSERT (total_rows는 우선 0 또는 알려진 총합).
    - upsert/row-log/field-log는 매 호출 실행.
    - `finalize=true`일 때만 inactivate_missing(전체 시트에서 본 abd_number 집합 사용) + finish/status 업데이트.
- **src/components/abd/import/AbdImportPage.tsx**
  - `startImport()`에서 파일 진입 시 `logId=null`, 시트 루프에서 순차 호출:
    - 첫 호출로 `logId` 획득
    - 각 호출 후 `progress = 10 + Math.round(((i+1)/sheets.length) * 80)`
    - 마지막 호출에 `finalize=true`, `all_sheet_numbers=[...seen]`
  - `agg` 집계는 그대로 유지.
- **회귀 확인**
  - `abd_import_row_logs`는 upload_id=batchId로 계속 append → OK.
  - Rollback (`preview_rollback_abd_import`, `rollback_abd_import`)이 batchId 하나로 동작하므로 파일 단위 롤백이 자연스러워짐(오히려 개선).
  - 백업 스냅샷(`takePreImportSnapshotWithFeedback`)은 파일 루프 진입 전 1회 → 변화 없음.

## 확인 방법
1. 260727 ELEC 파일 재임포트 → `abd_import_logs`에 파일당 1행, total_rows = Σ(시트 행수).
2. 진행률 바가 시트 완료마다 10%→~90%로 이동, 마지막 100%.
3. Raw Data 총 건수 = 두 Plot 합계와 일치.
