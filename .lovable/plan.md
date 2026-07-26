목표
- Dashboard KPI 카드 숫자와 Raw Data 행 수가 정확히 일치하도록 로직을 단순화합니다.
- SHAW PROJECT CMS의 방식처럼 "배지 삭제, 카드 숫자 = 테이블 행 수" 구조로 통일합니다.

현재 상황
- `TaskManagementRawDataPage.tsx`에서 기존 수동 `kpiSelection`/`delayFilteredRows`/`visibleRows` 로직을 TanStack Table `columnFilters` 기반으로 일부 전환했습니다.
- `modeToColumnFilters` 유틸을 추가하고 `useTmJudgmentAtDate`로 과거 Data Date 재판정을 병합했습니다.
- `bunx tsc --noEmit` 통과 상태이나, 불필요한 import/상태 정리가 남아 있습니다.

단계
1. KPI 조건 매핑 검증
   - `src/lib/task-management/kpi-utils.ts`의 Dashboard 산식과 `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`의 `modeToColumnFilters`를 항목별로 비교(diff)하여 불일치를 수정합니다.
   - 각 mode(`completed`, `wip`, `not_started`, `planned_started`, `actual_started`, `in_delay`, `behind`, `start_delayed`, `completion_overdue`, `critical`, `no_plan_start`, `no_plan_end`)가 정확히 동일한 유니버스를 산출하는지 확인합니다.

2. TM Raw Data 파일 정리
   - 더 이상 사용하지 않는 `delayMode`, `kpiMode`, `hideContextSubs`, `kpiSelection`, `kpiIsCompleted`, `kpiIsStarted`, `kpiIsPlannedStartedBy`, `kpiIsInDelay`, `kpiIsStartDelayed`, `kpiIsCompletionOverdue`, `kpiIsCriticalDelay`, `kpiIsBehindSchedule`, `scopeItems`, `TaskItem`, `ALL_TASK_TIMELINE_STAGE_KEYS`, `isTaskStageDelayedAsOf` 등의 import 및 상태를 제거합니다.
   - `renderRows`를 통해 collapse(접기) 상태는 UI에만 반영되고 집계에는 영향을 주지 않도록 유지합니다.

3. SM Raw Data에 동일 패턴 적용
   - `SM Raw Data` 페이지에서 동일한 "manual KPI filter + match/context badge" 패턴이 존재하는지 확인합니다.
   - 존재할 경우 `modeToColumnFilters`(`SM`용)와 `useSmJudgmentAtDate` 또는 서버 판정 병합 로직을 적용하여 동일하게 단순화합니다.
   - SM Dashboard → Raw Data 딥링크 파라미터를 구체적 필터 값으로 변경합니다.

4. ABD Raw Data 점검(필요 시)
   - ABD Raw Data에도 동일한 배지/수동 필터링이 남아 있다면 `ABD`용 `modeToColumnFilters`와 `abd_judge_at_date` 병합으로 통일합니다.
   - ABD는 현재 요청 범위 외이므로, TM/SM 이후 남은 시간에 처리합니다.

5. Dashboard → Raw Data 딥링크 파라미터 점검
   - `TmDashboardPage.tsx`, `SmDashboardPage.tsx`(또는 해당 컴포넌트)에서 KPI 카드 클릭 시 전달하는 `search` 파라미터가 `mode`, `asOf`, `taskScope`만 포함되도록 확인합니다.
   - `mode=behind` 같은 추상적 값은 그대로 두되, Raw Data에서 실제 `auto_judgment` 등 컬럼 필터로 풀어내야 합니다.

6. 프리뷰 검증
   - TM Dashboard의 "Behind Schedule · ELEC" 카드(또는 사용자가 제기한 51/27건 사례)를 클릭합니다.
   - Raw Data 페이지 상단 뱃지가 `행 수 / 전체`로만 표시되고, 카드 숫자와 테이블 행 수가 일치하는지 확인합니다.
   - 필터 칩에 "매치 · 컨텍스트" 같은 배지가 남아 있지 않은지 확인합니다.
   - SM에도 동일한 시나리오로 1건 이상 검증합니다.

7. 최종 타입체크 및 빌드 검증
   - `bunx tsc --noEmit` 재실행
   - 개발 서버 HMR 플러시 및 주요 화면 스크린샷 확인

결과물
- `TaskManagementRawDataPage.tsx`에서 KPI/지연 모드 관련 중복 필터링 제거
- `SmRawDataPage.tsx`(또는 동일 파일)에서 동일 구조로 단순화
- Dashboard → Raw Data 딥링크에서 카드 숫자 = 테이블 행 수 일치
- 불필요한 match/context 배지 완전 제거
