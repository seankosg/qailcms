# TM 임포트 컬럼 매핑 UI를 SM과 동일하게 전환 (+ 다중 시트 선택, 공종 "선택없음")

## 목표
현재 TM 임포트의 "필드 → 엑셀 컬럼 오버라이드" 방식(`ColumnMappingDialog`)을 폐기하고, SM과 동일한 "엑셀 헤더 include/exclude + 자동 매핑 표시 + 프리셋" UI로 전환합니다. 다중 시트 파일은 시트 선택 Select를 노출하며, 파일별 공종(discipline) Select에는 "선택없음" 옵션을 추가합니다.

## 결정된 요구사항
1. 완전히 SM과 동일한 UI (공용 `ColumnSelectDialog` 재사용).
2. 필드→컬럼 오버라이드 기능 및 관련 상태/컨텍스트/파서 경로 제거.
3. 상단 프리셋: `New Upload`, `Update` 2개.
4. 파일에 시트가 2개 이상이면 파일 카드 안에 시트 선택 Select를 노출하고, 시트 변경 시 재파싱.
5. 파일별 공종 Select에 "선택없음" 옵션을 추가하고, 선택없음일 때는 파일의 `discipline`을 `null`로 저장. 이 상태에서는 discipline이 필요한 다운스트림(예: preflight)에 대해 Ready 판정을 막고 안내 배지를 표시.

## 구현 범위

### 1. 파서 (`src/lib/task-management/parser.ts`)
- `ParseTaskManagementResult`에 SM과 동일한 필드 추가:
  - `availableHeaders: string[]`
  - `headerToFieldMap: Record<string, TaskTargetField | "">`
  - `headerSamples: Record<string, unknown>`
  - `availableSheets: string[]`
- `parseTaskManagement()` 시그니처 정리:
  - `sheetName?: string` — 지정 시 해당 시트, 없으면 기존 자동 감지
  - `excludedHeaders?: string[]` — 대응 canonical field를 결과 row에서 `null`로 두어 DB 값 유지
- 기존 `columnMap` override 파라미터 및 `sheetHeaders` 반환 제거(내부 계산 유지).

### 2. 컨텍스트 (`src/contexts/TaskManagementImportContext.tsx`)
- `TmImportFileItem`에서 `sheetHeaders`, `columnMap`, `columnOverrides` 제거.
- 추가: `availableHeaders`, `headerToFieldMap`, `headerSamples`, `excludedHeaders`, `availableSheets`, `sheetName`.
- `discipline: Discipline | null` 로 유지하고 null 허용을 명시.
- 액션:
  - 제거: `setFileColumnOverrides`
  - 신규: `setFileExcludedHeaders(id, excluded[])` — 재파싱 트리거
  - 신규: `setFileSheet(id, sheetName)` — 재파싱 트리거
  - `setFileDiscipline(id, Discipline | null)` — null 허용
- 파일 Ready 판정 조건에 `discipline != null`을 포함시켜 "선택없음" 상태에서는 임포트 버튼이 비활성.
- 업서트 페이로드 생성 시 `excludedHeaders`에 매핑된 canonical field는 payload에서 제외.

### 3. UI (`src/components/task-management/import/TaskManagementImportPage.tsx`)
- `ColumnMappingDialog` import/사용 제거.
- 신규 `TaskColumnSelect` 컴포넌트를 SM의 `DefectColumnSelect`와 동일 패턴으로 작성해 공용 `ColumnSelectDialog`에 helpers 주입:
  - `getRequirement`: `task_no` system 필수, Re-import 동일, Field Config required는 config 필수
  - `getSourceLabel/getSourceOrigin`: TM Field Config의 origin 사용 (없으면 `system`)
  - `isKnownField`: `TASK_TARGET_FIELDS` 또는 Field Config 등록 필드
  - 프리셋 2개:
    - `New Upload` — 전체 선택
    - `Update` — task_no + 진도/일정 필드(plan_start, plan_end, actual_start, actual_progress, plan_progress, progress_variance, forecast_end, slip_days, status_manual)만 유지
- `FileRow`:
  - 공종 Select: 상단에 `"선택없음"`(value sentinel `__none__`, 표시 라벨 "선택없음") 옵션 추가. 선택 시 컨텍스트에는 `null` 저장. 미선택/선택없음 상태이면 파일 배지에 "공종 선택 필요" 안내.
  - 시트가 2개 이상이면 시트 선택 Select 노출, 변경 시 `setFileSheet` 호출.
  - 기존 "컬럼 매핑" 버튼을 "컬럼 선택 (n/m)"으로 교체, 선택/제외 카운트 표시.

### 4. 파일 삭제
- `src/components/task-management/import/ColumnMappingDialog.tsx`

### 5. 부수 정리
- `previewTaskImport` preflight는 discipline이 필수이므로, discipline이 null인 파일은 preflight/Start Import 대상에서 자동 제외.
- 헤더 별칭은 기존 Admin > Task Management > Header Mapping을 계속 사용.

## 확인 필요 (진행 중 발생 시 즉시 문의)
- TM Field Config에 `origin` 개념이 정의되어 있지 않다면 배지 색상은 모두 `system`으로 표시.
- "선택없음" 상태의 파일에 대해 preflight 실행/충돌 다이얼로그 노출 여부는 기본적으로 차단으로 진행하되, 사용자가 다른 정책을 원하면 지시에 따라 조정.

## 기술 노트
- 공용 `src/components/import/ColumnSelectDialog.tsx`는 변경 없이 재사용.
- shadcn `Select` 컴포넌트는 빈 문자열 값을 허용하지 않으므로 "선택없음"은 sentinel `__none__` 값으로 렌더링하고 컨텍스트 저장 시 `null`로 변환.
- 오버라이드 제거로 임의 재매핑이 필요하면 Admin > Header Mapping에서 별칭을 등록해야 함을 다이얼로그 설명 문구에 명시.