
## 목표
현재 각 모듈의 Import Log는 행(Row) 단위 요약(`action_taken`, `reason_code`, `reason_detail`)만 표시합니다. SHAW 프로젝트처럼 **각 행을 확장하여 해당 행에서 처리된 개별 필드들의 상세(Field / Outcome / Raw / Applied / Previous / Reason)** 를 서브 테이블로 보여주고, 상단에서 Outcome 필터 및 `Field-level CSV` 다운로드를 지원하도록 이식합니다. 대상 모듈은 **TM, SM(Defect), ABD** 세 개입니다.

## 1. DB — 공용 `import_field_logs` 테이블
SHAW와 동일한 스키마를 채택하되, 소유권 검증만 우리 프로젝트 구조에 맞춥니다.

- 마이그레이션: `create_import_field_logs`
  - 컬럼: `id, upload_id (uuid), kind ('task_management'|'defect'|'abd'|'spare_part'), row_log_id (uuid, nullable), raw_row_no int, field_name text, outcome text CHECK, raw_value / applied_value / previous_value text, reason_code / reason_detail text, created_by uuid, created_at timestamptz`
  - 인덱스: `(upload_id)`, `(upload_id, outcome)`, `(upload_id, field_name)`, `(row_log_id)`
  - GRANT: `authenticated`(SELECT/INSERT), `service_role`(ALL)
  - RLS
    - SELECT: 인증 사용자 모두
    - INSERT: `is_admin_or_superuser(auth.uid())` OR 해당 `upload_id`의 `*_import_logs.uploaded_by = auth.uid()`
    - DELETE: 관리자/슈퍼유저 또는 배치 롤백 소유자

## 2. 필드 로그 수집 유틸 신설
`src/lib/import/field-log.ts` (SHAW의 `import-field-log.ts` 참조 이식)
- `FieldLogOutcome`, `PendingFieldLog`, `buildFieldLog(kind, args)`, `classifyChange(incoming, existing)`, `stringifyForLog`, `valuesEqual` 제공
- `kind`는 우리 모듈명(`task_management` / `defect` / `abd` / `spare_part`)에 맞춤

## 3. 임포트 파이프라인에 필드 로그 기록
각 모듈의 기존 배치 upsert 로직에 최소 침습으로 삽입합니다.

### 3-1. SM (`src/contexts/DefectManagementImportContext.tsx`)
- 배치별 `existingRow` 맵을 이미 갖고 있으므로 payload 필드 loop에서
  - 빈값 스킵 → `skipped_empty`
  - 값 동일 → `unchanged`
  - 다름 → `applied` (previous=existing)
  - 규칙 자동 분류/자동 채움은 `derived` / `auto_filled`
  - preflight team null, upsert 실패, priority_locked 스킵 → `rejected_invalid` / `rejected_conflict` / `skipped_no_permission`
- `pendingFieldLogs` 배열을 배치와 함께 누적, 250건 단위로 `import_field_logs` 삽입 (기존 row-log 삽입과 동일 패턴)

### 3-2. TM (`src/contexts/TaskManagementImportContext.tsx`)
- `existingSet` 대신 `existingByTaskNo` 맵을 사전 조회하도록 확장(성능 영향 최소화: 배치 단위 select)
- `plan_start / plan_end / forecast_end / actual_progress / actual_finish / discipline / team / level / main_task_no / hdec_pic / plot` 등 트래킹 필드 loop
- 이미 존재하는 Schedule Revision 감사 로직과 이중 기록되지 않도록 필드 로그 쪽에서만 previous/applied를 기록
- `rejectedByTaskNo` 사유는 `__row__` outcome=`rejected_invalid`로 1건 기록

### 3-3. ABD (`src/lib/abd/mutations.functions.ts`)
- upsert 전 `nums`로 조회하는 `existingRows`를 `select("abd_number, plot, ..., latest_status, ...")`로 확장
- `ABD_TRACKED_FIELDS`(스테이지 12개 + latest_status/approval_date/hdec_pic_name/hdec_eng_name/batch_no/document_title 등) loop로 로그 생성
- `inactivated` 행은 `__row__` outcome=`applied` reason_code=`missing_in_upload`
- `abd_import_row_logs` insert 이후 `import_field_logs`도 chunked insert

## 4. UI — `FieldLogTable` 컴포넌트 이식
`src/components/import/FieldLogTable.tsx` 신설 (SHAW 원본과 동일 UI/기능)
- Exports: `FieldLog` 타입, `FieldLogTable`, `FieldLogSummaryChips`, `OUTCOME_LABELS`, `downloadFieldLevelCsv(logs, filename)`
- 서브 테이블 컬럼: **Field / Outcome (배지) / Raw / Applied / Previous / Reason**
- Outcome별 배지 색상은 SHAW 매핑을 그대로 사용 (applied=blue, derived/auto_filled=violet, rejected_*=red 등)
- 빈값은 `—`로 표시

## 5. `ImportLogsPage` 확장 (통합 컴포넌트)
`src/components/import/ImportLogsPage.tsx` 수정 — 세 모듈 모두 공용이므로 한 번의 개편으로 이식 완료.

- 배치 선택 시 서버에서 해당 `upload_id`의 `import_field_logs` 전체를 `fetchAllByUploadId` 유틸(신설, 1000-row paging)로 로드하여 `raw_row_no`별로 그룹화
- 각 행 로그 왼쪽에 확장 아이콘(`ChevronRight/ChevronDown`) 추가
  - 확장 시 `<TableRow colSpan=(현재 컬럼수)>` 안에 `<FieldLogTable logs={grouped[rawRowNo]} />` 렌더
  - 필드 로그가 없는 행은 "No field-level details for this row." 문구 표시
- 상단 필터 툴바에 신규 컨트롤 추가
  - `Field outcome` 드롭다운 (multi/single은 SHAW와 동일: single Select, 'all' 옵션)
  - `Field name` 텍스트 검색
  - `Field-level CSV` 버튼 → `downloadFieldLevelCsv`
  - 요약 `FieldLogSummaryChips`를 배치 헤더 아래에 배치
- kind별 `row_logs` 테이블/컬럼(discipline, task_no / source_issue_no / abd_number)은 기존 그대로 유지하고, colSpan만 kind에 따라 조정

## 6. 검증
1. `tsgo`로 타입 통과 확인
2. TM/SM/ABD 각 1건씩 소량 파일 임포트 → `import_field_logs` 삽입 여부, 확장 UI에서 필드 상세 노출 확인
3. Field outcome 필터·CSV 다운로드 동작 확인
4. RLS: 일반 user는 본인이 업로드한 배치만 필드 로그를 확인 가능 여부(현행 row-log 정책과 동일 수준 유지)

## 마이그레이션 제약
- 소급 데이터 없음: 기존에 업로드된 배치는 필드 로그가 없으므로 확장 시 "No field-level details" 표시. 사용자에게 안내.
- Spare Part / Warranty 탭은 이번 스코프 밖 (요청은 TM/SM/ABD)

## 세부 파일 목록
- 신규
  - `supabase/migrations/<ts>_create_import_field_logs.sql`
  - `src/lib/import/field-log.ts`
  - `src/lib/import/fetch-all-by-upload.ts`
  - `src/components/import/FieldLogTable.tsx`
- 수정
  - `src/components/import/ImportLogsPage.tsx`
  - `src/contexts/DefectManagementImportContext.tsx`
  - `src/contexts/TaskManagementImportContext.tsx`
  - `src/lib/abd/mutations.functions.ts`
