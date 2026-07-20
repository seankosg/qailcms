# TM Dashboard 상단 KPI 카드 이식안 (확정)

SHAW `PunchDashboardPage`의 상단 카드 3단(Tier 1 진도율 · Tier 1.5 Status Mix · Tier 2 리스크)을 TM 대시보드 필터 바 아래에 그대로 이식합니다. 기존 KPI 스트립은 완전 교체합니다.

## 배치

```
Task Management Dashboard
[Data Date 선택 · 팀/PIC/ENG 필터 바 · Task Scope 토글(신규)]
[Tier 1: Completed | Planned | Actual | In Delay]   ← 신규
[Tier 1.5: Status Mix 스택 바]                       ← 신규
[Tier 2: Start Delayed | Completion Overdue | Critical | Behind]  ← 신규
[지연 Top 20 · Owner Leaderboard · Weekly Trend ...] (기존 유지)
```

기존 `KpiStrip` 사용처(`TmDashboardPage` 상단)는 제거하고 신규 카드로 완전 교체. 하위 위젯(지연 Top / Leaderboard / Trend)은 그대로 두되 동일한 `taskScope` 필터를 함께 적용.

## Task Scope 토글

- 위치: 필터 바 우측
- 값: `All` / `Main Task` / `Sub Task` (**기본 `All`**)
- URL search param `taskScope`, `level` 컬럼 기준 클라이언트 필터
- 모든 KPI · Status Mix · Tier 2 · 하위 위젯이 이 스코프를 참조

## Tier 1 — 진도율 카드 4개

| 카드 | 값 | 서브 | 이동 |
|---|---|---|---|
| Completed | 완료수/전체 · emerald bar | `X/Y items` | Raw Data · 완료 필터 |
| Planned Progress | 가중 계획 진도율(%) | 계획착수/전체 | Raw Data · planned_started |
| Actual Progress | 가중 실적 진도율(%) · emerald bar | 실제착수/전체 | Raw Data · actual_started |
| In Delay | 지연 건수 · danger tone (% 우선) | X/Y items | Raw Data · 기존 지연 모드 재사용 |

가중 진도율 산식은 SHAW `weightedProgress` 시그니처를 참고해 TM 컬럼(`plan_start`, `plan_end`, `actual_start`, `actual_progress`, `slip_days`, `auto_judgment`)로 매핑, `asOfDate` 기준 계산.

## Tier 1.5 — Status Mix 스택 바

3구간 · 클릭 시 Raw Data 이동(기존 필터 리셋 후 해당 상태만 적용):
- Completed (emerald)
- WIP (blue) — 착수 & 미완료
- Not Started (slate) — 미착수

## Tier 2 — 리스크 카드 4개

| 카드 | 조건 |
|---|---|
| Start Delayed | `plan_start < asOf` & 미착수 |
| Completion Overdue | `plan_end < asOf` & progress<100 |
| Critical Delay | `slip_days ≥ criticalSlipDays` |
| Behind Schedule | Actual% − Planned% < 0 |

각 카드 클릭 → Raw Data 이동(기존 필터 리셋 후 해당 조건만, `source=dashboard`).

## Critical Slip Days — 양방향 연동

- 저장소: `task_management_settings` 테이블의 기존 `critical_slip_days` 컬럼 재사용(없으면 마이그레이션으로 추가, 기본 7).
- 조회 훅: `useTaskManagementSettings` (신규 or 기존 재사용) — Dashboard와 Raw Data 양쪽에서 공용.
- Raw Data의 "임계값 설정" 버튼과 **동일한 팝오버 컴포넌트**를 재사용(`CriticalThresholdPopover.tsx`로 추출). Dashboard의 Critical Delay 카드 헤더 우측에 같은 톱니 버튼 노출.
- 저장 시 `task_management_settings` UPSERT + React Query invalidate → Raw Data · Dashboard 모두 즉시 반영(양방향 동기화).
- Admin > Task Thresholds 페이지 값도 동일 소스이므로 3곳(Admin / Raw Data / Dashboard)이 자동 연동.

## 데이터 흐름

- `useTaskDashboardData`는 그대로 사용(전체 로드). `taskScope`는 클라이언트에서 `level` 필터로 적용.
- `criticalSlipDays`는 별도 훅으로 로드해 KPI 계산에 주입.
- 산식은 신규 `src/lib/task-management/kpi-utils.ts`에 집약:
  `weightedProgress`, `computeStatusMix`, `isStartDelayed`, `isCompletionOverdue`, `isCriticalDelay(row, threshold)`, `isBehindSchedule`.

## 신규 / 수정 파일

**신규**
- `src/components/task-management/dashboard/TmKpiCards.tsx` — Tier 1/1.5/2 컨테이너 + Task Scope 토글
- `src/components/task-management/dashboard/ProgressKpiCard.tsx`
- `src/components/task-management/dashboard/RiskKpiCard.tsx`
- `src/components/task-management/dashboard/StatusMixBar.tsx`
- `src/components/task-management/shared/CriticalThresholdPopover.tsx` — Raw Data · Dashboard 공용
- `src/lib/task-management/kpi-utils.ts`
- `src/hooks/useTaskManagementSettings.ts` (없다면)

**수정**
- `src/components/task-management/dashboard/TmDashboardPage.tsx` — 기존 KpiStrip 자리에 `<TmKpiCards />` 삽입, `taskScope` state 관리, 하위 위젯에 `taskScope` prop 전달
- `src/routes/_authenticated/closure/task-management/dashboard.tsx` — search schema에 `taskScope: 'all' | 'main' | 'sub'` 기본 `all` 추가
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` — `source=dashboard`에서 신규 모드(`planned_started`, `actual_started`, `status:completed|wip|not_started`, `start_delayed`, `overdue`, `critical`, `behind`) 분기 추가. 기존 임계값 설정 버튼을 신규 공용 `CriticalThresholdPopover`로 교체.
- `src/routes/_authenticated/admin/task-thresholds.tsx` — 저장 소스가 동일하므로 훅만 신규 훅으로 통일(로직 변경 없음)

**제거**
- 기존 `KpiStrip` 참조부는 대시보드에서 제거(컴포넌트 자체는 다른 페이지에서 쓰지 않으면 삭제).

## 시각 스타일

SHAW 톤 유지: emerald=완료/실적, blue=진행, amber=주의, red=위험, slate=미착수. 카드 프레임은 프로젝트 shadcn `Card` 표준.
