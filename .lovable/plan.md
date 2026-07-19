## 목표
TM 임포트를 SM(Defect) 임포트와 동일한 UI/로직으로 전환. 다중시트 파일일 때는 시트 선택 UI를 노출하고, 컬럼 매핑은 "헤더 리스트 + 체크박스 + 프리셋" 방식(SM의 `ColumnSelectDialog`)을 재사용한다. 공종(Discipline) Select에는 "선택없음" 옵션을 추가하고, "선택없음" 상태에서는 임포트를 진행할 수 없게 한다.

## 범위
- 대상: `src/lib/task-management/parser.ts`, `src/contexts/TaskManagementImportContext.tsx`, `src/components/task-management/import/TaskManagementImportPage.tsx`, 신규 `src/components/task-management/import/TaskColumnSelect.tsx`.
- 삭제: `src/components/task-management/import/ColumnMappingDialog.tsx` (더 이상 사용하지 않음).
- 그대로 유지: 서버 롤업/판정, `ConflictDecisionDialog`, `MasterMappingSection`, preflight 로직, `INSERT_CHUNK`, 트랜잭션 결과 처리, DB 스키마.

## 상세 설계

### 1) 파서 (`src/lib/task-management/parser.ts`)
- 신규 export:
  - `getTaskExcelSheetNames(file): Promise<string[]>` — `XLSX.read(..., { bookSheets:true })`로 시트명 리스트만 반환.
  - `getTaskExcelHeaders(file, sheetName?)` — SM의 `getDefectExcelHeaders`와 동일한 형태로 `{ sheetName, headers, entries, sample }` 반환. 기존 `buildHeaderMap`이 자동 감지한 헤더 행의 `SheetHeaderEntry[]`를 사용.
  - `isKnownTaskField(field)`, `toTaskFieldName(header, aliases)` — SM 대응 함수.
- `ParseTaskManagementOptions`에 `sheetName?: string`, `excludedHeaders?: string[]` 추가. 기존 `columnOverrides`는 폐기(하위 호환 필요 없음, TM 전용이라 안전).
- `ParseTaskManagementResult`에 SM과 동일한 필드 추가: `availableHeaders`, `headerSamples`, `headerToFieldMap`, `excludedHeaders`, `excludedFields`. `columnMap`/`sheetHeaders`는 프리뷰/디버깅용으로 유지.
- `parseTaskManagementExcel` 내부에서 `excludedHeaders`를 canonical field로 변환 후 해당 target을 매핑에서 제외. `task_no`는 시스템 필수라 excluded이더라도 항상 매핑.

### 2) 컨텍스트 (`src/contexts/TaskManagementImportContext.tsx`)
- `TmFileStatus`에 `pending_sheet_selection` 추가.
- `TmImportFileItem`에 `sheetNames`, `availableHeaders`, `headerSamples`, `headerToFieldMap`, `excludedHeaders` 추가. `columnOverrides` 및 `setFileColumnOverrides` 제거.
- `discipline` 타입을 `Discipline | null`로 완화하고 초깃값을 `null`("선택없음")로 지정. `disciplineHint`가 있어도 자동 배정하지 않고 사용자 확인을 요구.
- `addFiles`:
  1. `getTaskExcelSheetNames`로 시트 리스트 획득.
  2. 시트가 2개 이상이면 status를 `pending_sheet_selection`으로 두고 대기.
  3. 시트가 1개면 `getTaskExcelHeaders`로 헤더 프리뷰 캡처 후 `parseAndApply` 호출.
- 신규 `parseAndApply(id, file, sheetName?, excluded?)` (SM 동일): `parseTaskManagementExcel` 호출 후 파일 상태 갱신.
- 신규 `setFileSheet(id, sheetName)` / `setFileExcludedHeaders(id, excluded[])` (SM과 동일 흐름).
- `startImport` 진입 검사에서 `discipline == null`이면 `toast.error("공종을 선택하세요")` 후 중단. 실행 파일 조건에도 `!!f.discipline` 추가.
- `executeImport` 내부에서 `discipline`은 null 아님이 확정된 상태로 사용.

### 3) UI (`TaskManagementImportPage.tsx`)
- `statusBadge`에 `pending_sheet_selection: { label:"시트 선택 대기", cls:"bg-amber-100 text-amber-800 …" }` 추가.
- `FileRow`:
  - 공종 Select 옵션 첫 항목으로 `<SelectItem value="__none">선택없음</SelectItem>` 추가. 값 매핑: `"__none"` ↔ `null`. 초깃값이 null이면 `SelectValue placeholder="공종 선택"`.
  - `sheetNames.length > 1` 이면 공종 Select 오른쪽에 시트 Select 추가 (`onSheetChange={(s)=>setFileSheet(f.id, s)}`).
  - 기존 "컬럼 매핑" 버튼을 "컬럼 선택"으로 라벨 변경, `Columns3` 아이콘 유지. 클릭 시 `TaskColumnSelect` 오픈. 노출 조건: `availableHeaders` 존재.
  - Start import 버튼 disable 조건에 `files.some(f=>f.status==="ready" && !f.discipline)` 포함(사실상 `readyCount`가 null인 파일을 제외한 개수라 자동 반영). readyCount 계산도 `!f.discipline`을 ready에서 제외.
- 페이지 하단의 `ColumnMappingDialog` 렌더링을 `TaskColumnSelect`로 교체.

### 4) 신규 `TaskColumnSelect.tsx`
- SM의 `DefectColumnSelect`를 그대로 참조한 얇은 래퍼. `ColumnSelectDialog` 재사용.
- `useTaskManagementFieldConfig` 기반의 헬퍼 정의: `getRequirement`는 `task_no` 필드를 system 필수로 강제. Field Config에서 `is_required` 컬럼이 없으므로 `field_config`상의 `is_visible=false`만으로 필수 강제하지는 않고, `task_no`만 시스템 필수로 취급 (SM은 `source_issue_no`가 시스템 필수인 것과 동일).
- 프리셋:
  - `New Upload` — 전체 유지(matchedHeaders undefined).
  - `Update` — 진도/일정/판정 필드만 유지: `task_no, status_manual, plan_start, plan_end, plan_days, actual_start, actual_progress, plan_progress, progress_variance, forecast_end, slip_days, auto_judgment`.
- `helpers.isKnownField = isKnownTaskField`. `getSourceLabel/Origin`은 TM용 필드 config에는 origin 개념이 없어 undefined로 전달(배지 미노출).

### 5) 삭제
- `src/components/task-management/import/ColumnMappingDialog.tsx` (`rm`).

## 검증
- 단일 시트 xlsx → 업로드 즉시 헤더 리스트 감지 → "컬럼 선택" 버튼 사용 가능, 프리셋 동작.
- 다중 시트 xlsx → status `시트 선택 대기` 배지 노출 + 시트 Select 사용 후 파싱 시작.
- 공종 "선택없음" 상태에서 Start import 시도 → 경고 토스트 + 진행 차단.
- Excluded 후 재파싱 → `parentCount/childCount/warnings/preview`가 갱신되고 preflight 필요 시 다시 실행되도록 preflight 결과는 초기화.
- 기존 이름 마스터 매핑, 충돌 처리, 롤업/판정 재계산 흐름은 회귀 없음.

## 롤아웃
1. 파서 확장 및 신규 export.
2. 컨텍스트 리팩터.
3. 페이지/신규 다이얼로그 래퍼.
4. `ColumnMappingDialog.tsx` 삭제.
5. 프리뷰에서 다중 시트 파일과 excluded 시나리오를 수동 확인.
