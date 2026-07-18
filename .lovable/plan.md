## 목표
Task Management 임포트 시 같은 `task_no`가 DB에 이미 존재하면, 현재는 파일 단위 `충돌 정책(overwrite/skip/renumber)`만 일괄 적용됩니다. 사용자가 **충돌 항목별로 개별 처리 방식**을 선택할 수 있도록 팝업을 추가합니다.

## 현재 동작 확인 (이미 읽음)
- `src/contexts/TaskManagementImportContext.tsx`
  - `ConflictPolicy = "overwrite" | "skip" | "renumber"`
  - `runPreflight()` → `previewTaskImport` server fn으로 `new/update/unchanged/conflict` 계산
  - `executeImport()` 내에서 `conflictPolicy` 기본값 `overwrite`로 충돌 행 일괄 처리
- `src/lib/task-management/import-preflight.functions.ts`
  - `PreflightConflict`에 `task_no`, `reason`, DB/파일 비교 정보 포함
- `src/components/task-management/import/TaskManagementImportPage.tsx`
  - `ConflictReviewDialog`가 충돌 목록을 보여주기만 함 (선택 불가)
- `src/components/task-management/import/ConflictReviewDialog.tsx`
  - 읽기 전용 충돌 상세 테이블

## 구현 내용

### 1. Context 상태 확장 (`src/contexts/TaskManagementImportContext.tsx`)
- 파일별 `conflictDecisions?: Map<string, ConflictPolicy>` 추가
  - key: `task_no`, value: `"overwrite" | "skip" | "renumber"`
- `setConflictDecision(fileId, taskNo, policy)` / `clearConflictDecisions(fileId)` 추가
- `executeImport` 변경:
  - `conflictSet` 대신, **개별 결정이 있으면 해당 결정 우선** 적용
  - 결정이 없는 행은 파일 기본 `conflictPolicy` 적용
  - `renumber` 결정 시에만 `allocateTaskNo` 호출
- `startImport` 흐름 변경:
  - 충돌이 남아 있고 개별 결정이 없으면 import를 시작하지 않고 팝업을 띄움
  - 또는 "중복 점검" 후 충돌 팝업에서 사용자 확인 → import 시작

### 2. 충돌 선택 팝업 신규
- `src/components/task-management/import/ConflictDecisionDialog.tsx` 생성
- 목록:
  - `task_no` 컬럼
  - 사유 (`task_name_mismatch`, `parent_mismatch`, `plot_mismatch` 라벨)
  - DB 값 / 파일 값 비교
  - 각 행별 RadioGroup: `덮어쓰기` / `건너뛰기` / `재번호`
- 상단 일괄 선택 버튼: `전체 덮어쓰기`, `전체 건너뛰기`, `전체 재번호`
- 확인 클릭 시 개별 결정을 Context에 저장하고 import 진행
- 취소/닫기 시 import 중단

### 3. 기존 `ConflictReviewDialog` 연동
- "충돌 상세" 버튼을 누르면 기존 읽기 전용 대화상자 대신 새 `ConflictDecisionDialog`를 열도록 변경
- 또는 `ConflictReviewDialog`에 "이 충돌 처리하기" 버튼을 추가해 새 팝업으로 전환

### 4. Import 페이지 흐름 수정 (`TaskManagementImportPage.tsx`)
- "Start import" 버튼 클릭 시:
  1. 아직 `preflight`가 없는 파일은 자동으로 `runPreflight` 실행
  2. `conflictCount > 0`이고 개별 결정이 미완료인 파일이 있으면 `ConflictDecisionDialog`를 띄움
  3. 모든 충돌에 결정이 있으면 `executeImport` 실행
- 이미 `done`/`processing` 상태 파일은 제외

### 5. UI 피드백 강화
- 파일 카드에 다음 배지 추가:
  - `개별 결정 N건` (decisions가 있을 때)
  - `충돌 N건 미결정` (conflict가 있지만 decisions가 없을 때)
- Import 결과에 `resolvedByDecision`/`renumberedByDecision` 등 구분하여 노출

### 6. DB/스키마 변경
- 없음. 기존 `task_management_raw` upsert onConflict `(discipline, task_no)`만 사용.

## 기술 세부
- `Map<string, ConflictPolicy>`는 직렬화가 어려우므로 Context state에서는 `Record<string, ConflictPolicy>` 형태로 저장.
- `ConflictDecisionDialog`는 `TmImportFileItem` 1개를 받아 작동.
- `executeImport`의 충돌 처리 블록에서 `conflictSet`과 `renumberMap` 계산 시 개별 결정을 먼저 참조.
- `renumber` 후 parent_task_no가 바뀐 자식 행의 연결을 복구하는 기존 로직은 그대로 유지.

## 완료 기준
- 충돌이 있는 파일 import 시 사용자가 개별 행별로 처리 방식을 선택할 수 있다.
- 선택한 방식이 실제 insert/update/renumber/skip 집계에 정확히 반영된다.
- 파일 기본 충돌 정책은 개별 결정이 없는 행에 대한 fallback로 계속 작동한다.
- 타입스크립트 빌드 및 lint 통과.