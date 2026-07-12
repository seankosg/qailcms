# Task Dashboard 개편 계획 (v3) — SHAW Defect Progress 매트릭스 적용

## 요구 정리

1. Raw Data(`task_management_raw`)와 실시간 연동되는 **시각적 Task Dashboard**.
2. Dashboard는 도메인별(Task / Spare Part / Warranty / As-Built …)로 **분리도 가능하고 통합도 가능**한 구조.
3. SHAW PROJECT CMS `DefectProgressPage`의 **계획 대비 실적 비교 매트릭스**(DefectScheduleMatrix) 를 Task용으로 이식.
4. 지금은 Task만 구현. 나머지 도메인은 스텁.

## SHAW Defect Progress 매트릭스 분석 (이식 대상)

`src/components/defects/DefectScheduleMatrix.tsx` + `DefectProgressPage.tsx` 구조:

**행 (Group)**: team / plot / (다중 group 조합) — 사용자가 ToggleGroup으로 선택
**Sticky 좌측 요약 블록** (그룹 옆에 항상 붙어 있음):
- **Total Scope**: Total / Done / % / Remain
- **Up to Data Date (혹은 Today)**: Plan / Actual / % / Diff
**우측 스크롤 타임라인 (Day/Week 버킷)**:
- 각 bucket × 각 stage(start/completion/closure)마다 Plan cell, Actual cell 2개 (또는 계 1개)
- 셀 색상: Plan=blue, Actual=green, Actual>Plan=over(주황), Actual<Plan=short(적)
- 셀 클릭 → Raw Data 페이지로 필터 딥링크

**툴바 컨트롤**:
- Group (team/plot/… 다중 선택)
- Team 필터
- Bucket (Day/Week)
- Stage 필터 (Start/Comp/Close 다중)
- As-of (Data Date/Today)
- Range (14/30/60/90일)
- Lookup 날짜 → Raw Data 딥링크
- Plan mode (Remaining/Baseline)
- Hide past / Risk Panel 토글

**KPI 상단 4카드**: Cumulative Progress / Delay / Critical (≤7d) / Upcoming 7d Plan
**Risk Panel (우측 옵션)**: High Risk / Bottleneck / Lagging Groups

핵심 라이브러리: `@tanstack/react-virtual` (행/열 가상화 이미 프로젝트에 있는지 확인 필요).

## Task 도메인 매핑 (Defect stage → Task 개념)

Defect는 3-stage(Start/Completion/Closure)로 이산 완료를 세지만, Task는 `actual_progress` 연속값.
Task에 맞춰 아래와 같이 **재정의**:

| SHAW 개념 | Task 매핑 |
|---|---|
| stage=start | **Start**: `plan_start` vs `actual_start` (있으면 1, 없으면 0) |
| stage=completion | **Completion**: `plan_end` vs (`actual_progress >= 1`) |
| stage=closure | 사용 안 함 (또는 향후 확장) |
| Total Scope Total | 필터 후 task 개수 |
| Total Scope Done | actual_progress==1 개수 |
| Up to X Plan | bucket ≤ X 중 plan_end 도래 개수 (Completion 기준) |
| Up to X Actual | bucket ≤ X 중 실제 완료 개수 |
| Diff | Actual - Plan |
| 셀(bucket, plan) | 해당 bucket에 `plan_end`(또는 `plan_start`) 예정 개수 |
| 셀(bucket, actual) | 해당 bucket에 실제 완료(또는 실제 시작) 발생 개수 |
| Plan mode Remaining | 이미 완료된 task는 plan에서 제외 |
| Plan mode Baseline | 전체 plan 그대로 |
| Critical(≤7d) | 오늘부터 7일 내 plan_end 존재 && 미완료 |
| Delay | `todayGap < 0` (경중은 임계값 기반) 개수 |

**추가 Task 고유 옵션**:
- Stage 필터를 "Start / Completion" 두 개로 축약.
- Bucket cell에 "예정 진도율(계획 %)" vs "실적 진도율 평균" 표시 옵션도 추가 가능 (첫 버전은 count 기반, S-Curve 위젯에서 % 시각화).

## 라우트 구조 (통합/분리 양립)

```text
/closure/dashboard                → 통합 Overview (도메인 요약 위젯 그리드)
/closure/dashboard/task           → Task Dashboard (매트릭스 + 위젯)
/closure/dashboard/spare-part     → 스텁
/closure/dashboard/warranty       → 스텁
/closure/dashboard/as-built       → 스텁
```

- 사이드바 "Dashboard" 링크 → `/closure/dashboard`.
- 기존 `src/routes/_authenticated/closure/spare-part/dashboard.tsx` 삭제, `TaskDashboardCards.tsx` 로직 흡수 후 삭제.

## 위젯 아키텍처 (도메인 확장/재조립 가능하도록)

```ts
// src/lib/dashboard/types.ts
export interface DashboardWidget<F> {
  id: string;                        // "task.plan-vs-actual-matrix"
  domain: "task" | "spare-part" | "warranty" | "as-built";
  title: string;
  size: "sm" | "md" | "lg" | "xl";
  Component: React.FC<{ filters: F; compact?: boolean }>;
}
```

- `compact=true`: 통합 Overview에서 축약 렌더.
- `compact=false`: 개별 도메인 페이지에서 전체 렌더.
- `src/lib/dashboard/registry.ts`에서 위젯을 등록 → Overview는 registry 기반 자동 조립.
- 향후 도메인 추가: widget 파일 + registry 등록 + 라우트 1개면 끝.

## 파일 배치

```text
src/lib/dashboard/
  types.ts
  registry.ts

src/components/dashboard/
  DashboardHubPage.tsx           # /closure/dashboard
  ComingSoonWidget.tsx

src/components/task-management/dashboard/
  TaskDashboardPage.tsx          # /closure/dashboard/task
  filters/TaskDashboardFilterBar.tsx
  widgets/
    KpiStrip.tsx                 # SHAW Kpi 스타일 4개 카드
    PlanVsActualMatrix.tsx       # ★ SHAW DefectScheduleMatrix 이식
    JudgmentDonut.tsx
    DisciplineBar.tsx
    TeamHeatmap.tsx
    SCurve.tsx
    BehindScheduleTable.tsx
    CriticalWatchlist.tsx        # SHAW DefectCriticalWatchlist 축약 이식

src/lib/task-management/
  schedule-utils.ts              # ★ SHAW defect-schedule-utils 이식 + Task 매핑
  scurve.ts

src/hooks/useTaskDashboardData.ts
```

## Task용 schedule-utils.ts 신설

SHAW의 `src/lib/defect-schedule-utils.ts`를 참고해 Task 전용으로 신규 작성:

- 타입: `TaskScheduleBucket = "day"|"week"`, `TaskScheduleStage = "start"|"completion"`, `TaskScheduleGroupBy = "discipline"|"team"|"plot"`.
- 함수:
  - `isTaskStagePlannedOn(row, stage, iso)`
  - `isTaskStagePlannedUpTo(row, stage, iso)`
  - `isTaskStageActualUpTo(row, stage, iso)` (completion은 `actual_progress==1`, start는 `actual_start<=iso`)
  - `isTaskStageDelayedAsOf(row, stage, iso)`
  - `aggregateTaskSchedule(rows, opts)` → `{ buckets: string[], rows: GroupRow[] }`
  - `findTaskCritical`, `findTaskLaggingGroups`
- 판정 임계값은 `task_management_settings`에 이미 있는 로더 재사용 (없으면 `DEFAULT_THRESHOLDS`).

**모든 파생값은 `src/lib/task-management/derived.ts`의 `expectedProgressToday`, `todayGap`, `computeJudgment`와 정합**을 유지 → Raw Data 화면과 수치 일치 보장.

## PlanVsActualMatrix 컴포넌트

SHAW `DefectScheduleMatrix.tsx`를 그대로 이식하되:

- import 경로/타입 → Task 전용으로 교체.
- ScheduleCell 컴포넌트는 SHAW의 `src/components/schedule/ScheduleCell.tsx`도 함께 이식 (색상 토큰 포함).
- 색상 토큰: SHAW의 `--schedule-plan`, `--schedule-actual`, `--schedule-over`, `--schedule-short` 4종을 `src/styles.css`에 추가 (라이트/다크 모두). 하드코딩 금지.
- `@tanstack/react-virtual` 미설치면 `bun add @tanstack/react-virtual`.
- 셀 클릭 시 딥링크: `/closure/task-management/raw-data`로 `q`, discipline, team, plot, plan_start range 등 파라미터 전달.
- Group 라벨은 `useTmColumnLabel()` 통해 Field Config Display Name 반영.

## 필터 상태 관리

- URL search params 기반 (`validateSearch` + `zodValidator(fallback+default)`).
- 필터: `group[]`, `bucket`, `stageView[]`, `asofMode`, `team`, `range`, `hidePast`, `riskPanel`, `pickedDate`, `pickedField`, `planMode`, `discipline[]`, `plot[]`, `q`.
- 딥링크 재현/공유 가능.

## KPI + Watchlist + 부가 위젯

매트릭스 상단/우측에 배치:
- **KPI 4카드**: Cumulative Progress / Delay Up to Data Date / Critical(≤7d) / Upcoming 7d Plan — 클릭 시 Raw Data 딥링크.
- **Critical Watchlist**(우측 접이식): High Risk / Bottleneck (Completion 오래 대기) / Lagging Groups.
- **보조 위젯**(매트릭스 하단):
  - 자동 판정 도넛
  - 공종별 진도 스택바
  - S-Curve (계획 vs 실적) — 이번 버전은 현재 스냅샷 근사.

## Overview 통합 뷰(`/closure/dashboard`)에서의 재사용

- Task 도메인 카드: KpiStrip(compact), PlanVsActualMatrix(compact=축약 — 그룹 상위 5, 최근 30일)로 노출.
- 나머지 도메인은 `ComingSoonWidget`.
- Overview에서 각 도메인 카드 헤더 클릭 시 개별 페이지로 이동.

## 데이터 로딩

- `useTaskDashboardData(filters)`가 `task_management_raw`에서 필요 컬럼만 select. 1000행 초과 시 range 페이징.
- 판정/스케줄 파생값은 클라이언트 계산 (Raw Data와 동일 유틸).
- 로더에서 `queryClient.ensureQueryData` 프라이밍, 컴포넌트에서 `useSuspenseQuery`.
- 라우트에 `errorComponent`, `notFoundComponent` 필수 정의.

## 디자인 토큰

- SHAW `schedule-*` 팔레트 4종을 `src/styles.css`에 시맨틱 토큰으로 이식 (라이트/다크).
- 기존 `AUTO_JUDGMENT_COLORS`, `DISCIPLINE_COLORS`, `TEAM_COLORS`, `RISK_COLORS` 재사용.
- Recharts 시리즈 색은 `--chart-*` 혹은 판정 토큰 사용, 하드코딩 금지.

## 기존 리소스 처리

- `src/routes/_authenticated/closure/spare-part/dashboard.tsx` 삭제.
- `src/components/task-management/dashboard/TaskDashboardCards.tsx` 로직 흡수 후 삭제.
- `AppLayout.tsx` 사이드바 "Dashboard" 링크만 `/closure/dashboard`로 변경.

## 신규 의존성 (필요 시 설치)

- `@tanstack/react-virtual` — 매트릭스 열 가상화.
- `recharts` — 도넛/바/S-Curve 차트.
- `date-fns` — SHAW 코드에서 사용, 프로젝트 미설치면 추가.

## 이번 범위에서 제외 (다음 이터레이션)

- S-Curve의 이력 기반(과거 스냅샷) 정확 산출 (`task_management_status_history` 활용).
- 사용자별 위젯 pin/순서 저장.
- Excel Export (SHAW `dashboard-excel-export`와 동일 스타일). 필요 시 후속 태스크.
- Spare Part / Warranty / As-Built 실제 위젯 구현.

## 확인 필요 사항

1. Task의 "stage"는 **Start / Completion** 두 개로 시작해도 되나요? (Defect의 Closure에 상응하는 개념 없음)
2. Bucket 셀 값은 **건수 기반**(SHAW 방식)으로 시작하고, "진도율 %" 표시는 별도 S-Curve/DisciplineBar 위젯으로 두는 방향 OK?
3. SHAW의 Plan mode(Remaining/Baseline), Hide past, Risk Panel 토글까지 그대로 이식 진행 OK?
4. Recharts + `@tanstack/react-virtual` 도입 승인 부탁드립니다.
