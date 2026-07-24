
## 배경

- TM Raw Data 툴바의 **Rollup**은 DB 트리거 `trg_task_rollup`이 이미 자동 롤업을 수행하므로 상시 노출 불필요.
- **Judgment**(전체 auto_judgment 재계산)는 실제로는 `CriticalThresholdPopover`의 임계값 변경 직후에만 의미가 있음. Popover에는 이미 "저장+재계산" 버튼이 있어 흡수 가능.
- **Refresh**는 React Query refetch로 다른 사용자 편집 반영에 유용하므로 유지.

## 변경 내용

### 1) `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- 툴바에서 "Rollup" 버튼과 "Judgment" 버튼 제거.
- 관련 상태/핸들러 삭제:
  - `rollupBusy` state
  - `rollupFn`, `judgmentFn` 훅 (`useServerFn`)
  - `handleRollup`, `handleRecalcJudgment` 함수
- import 정리: `runRollupAllMains`, `runRecalcAutoJudgment` import 제거.
- 남은 툴바 아이콘(`RefreshCcw`)은 Refresh 버튼에만 사용.

### 2) `src/components/task-management/shared/CriticalThresholdPopover.tsx`
- 현재 이미 "저장" / "저장+재계산" 두 버튼을 제공 중이며 `runRecalcAutoJudgment`를 호출하는 흐름이 완성되어 있음 → **추가 변경 없음**. (Judgment 기능은 이 Popover의 "저장+재계산" 액션으로 흡수된 상태로 확정)
- 관리자 문구만 정리: "임계값을 바꾸지 않고도 전체 재계산이 필요하면 값을 그대로 두고 '저장+재계산' 클릭"이라는 안내 한 줄을 버튼 위에 추가하여 Judgment 버튼 폐기로 인한 사용자 혼선을 방지.

### 3) 서버 함수 보존
- `runRollupAllMains`, `runRecalcAutoJudgment` (in `src/lib/task-management/rollup.functions.ts`)는 삭제하지 않음.
  - `runRecalcAutoJudgment`: `CriticalThresholdPopover`와 `admin/task-thresholds` 페이지가 계속 사용.
  - `runRollupAllMains`: 관리자 콘솔/향후 마이그레이션용으로 보존(호출 지점 없음 상태 OK). 참조 없다는 lint 경고가 나면 파일 상단에 유지 사유 주석만 추가.

## 검증

- 툴바에서 Rollup/Judgment 버튼이 사라지고 Refresh만 남아 정상 동작.
- `CriticalThresholdPopover` "저장+재계산" 클릭 시 기존과 동일하게 `updated: N행` 토스트 표시 및 `task-management-raw` 캐시 무효화.
- `admin/task-thresholds` 페이지의 "저장 + 전체 재계산" 정상 동작.
- 타입체크·빌드 통과, 미사용 import 없음.
