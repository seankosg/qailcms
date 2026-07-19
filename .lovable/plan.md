# TM 일정/지연 관리 대시보드 계획

## 배치 및 라우팅

- 신규 라우트 `src/routes/_authenticated/closure/task-management/dashboard.tsx` → 경로 `/closure/task-management/dashboard`.
- 사이드바 `Task Management` 모듈 최상단(Task Summary 위)에 `Dashboard` 링크 추가 (`AppLayout.tsx`).
- 기존 `/closure/dashboard/task`(전사 개요 축약)는 그대로 유지. 신규 페이지는 TM 전용 상세 대시보드.

## 화면 구조 (SHAW T&C DashboardPage 참조)

```
[Header]  Task Progress & Delay Dashboard   |   As-of Today · Data Date · Rows N
[Quick Filter Pills]  Team ▾  ·  HDEC PIC ▾  ·  HDEC ENG ▾   (다중선택 pill)
[Toolbar]  Group(다중) · 공종 · Plot · Bucket(Day/Week) · Stage · As-of · Range · Plan(Baseline/Remaining) · 검색
[KPI Strip]  누적 계획 · 누적 실적 · Variance% · 진도% · 지연 스테이지 수 · 이번주 예정 · Critical
[Row A]  좌: Plan vs Actual S-Curve (Cumulative + Weekly Variance Bar)
         우: Judgment Donut (완료/정상/주의/지연/위험)  +  스테이지별 스택바(Start/Comp × 판정)
[Row B]  주간 신규 지연 vs 회복 트렌드 라인 (12주)
[Row C]  Plan vs Actual Matrix (기존 컴포넌트 재사용, 그룹 축·버킷 반응)
[Row D]  좌: Delay Top N 태스크 테이블 (지연일수 desc, 20건, 클릭→Raw Data 필터)
         우: Owner Leaderboard (Team | HDEC PIC | HDEC ENG 탭 전환) — 계획 진도 vs 실적 진도 + 차이 + 지연 태스크 수
```

## 상단 축(빠른 필터 pill)

기존 다중 선택 Group 축은 유지하면서, 상단에 담당자 축 빠른 필터를 별도 pill 그룹으로 추가:
- Team, HDEC PIC, HDEC ENG 각각 풀다운 다중 선택 pill.
- 값은 프로필 마스터가 아닌 실제 `task_management_raw` 값에서 distinct 도출(팀 필터에 연동됨).
- 선택값은 URL search param에 반영되어 모든 위젯에 적용.

## 데이터 흐름

- 기존 `useTaskDashboardData` 훅 확장: `hdecPic?: string[]`, `hdecEng?: string[]` 인자 추가. 클라이언트 측 필터로 처리(현재 훅과 동일 패턴).
- 기존 `aggregateTaskSchedule`, `isTaskStageDelayedAsOf`, `findTaskCritical` 재사용.
- 신규 유틸(`src/lib/task-management/delay-utils.ts`):
  - `computeDelayTopN(items, asOfDate, limit)` — 스테이지 지연일수 기준 Top N.
  - `computeOwnerLeaderboard(items, asOfDate, dim)` — dim ∈ `team | hdec_pic_name | hdec_eng_name`. 각 오너별 총/완료/지연 스테이지 수, 계획진도율, 실적진도율, 차이.
  - `computeWeeklyDelayTrend(items, weeks=12, today)` — 주별 신규 지연(해당 주에 처음 지연 진입) vs 회복(지연 상태에서 완료) 카운트.
  - `computeJudgmentStageBreakdown(items, asOfDate)` — 판정 × 스테이지(Start/Comp) 카운트.

## 신규 컴포넌트

- `src/components/task-management/dashboard/TmDashboardPage.tsx` — 라우트 컴포넌트, 툴바+레이아웃 오케스트레이션.
- `src/components/task-management/dashboard/OwnerQuickFilterPills.tsx` — Team/HDEC PIC/HDEC ENG 다중 선택 pill.
- `src/components/task-management/dashboard/TaskPlanVsActualCurve.tsx` — Recharts 기반 S-Curve + Variance 바(SM `SnagPlanVsActualCard`와 동일한 시각 언어, 양수 초록/음수 빨강).
- `src/components/task-management/dashboard/DelayTopTable.tsx` — 지연 Top N 표.
- `src/components/task-management/dashboard/OwnerLeaderboardCard.tsx` — 내부 Team/HDEC PIC/HDEC ENG 탭 전환. 각 행: 이름, 스테이지 수, 지연 수, Plan% Bar, Actual% Bar, Diff(음수 빨강 뱃지).
- `src/components/task-management/dashboard/WeeklyDelayTrend.tsx` — 신규 지연 vs 회복 라인 차트.
- `src/components/task-management/dashboard/JudgmentStageBreakdown.tsx` — 도넛(전체) + 우측 스테이지 스택바.

## 재사용 컴포넌트

- `PlanVsActualMatrix`, `KpiStrip`, `ScheduleLegend`, `CriticalWatchlist`, `BehindScheduleTable`(원하면 Row C 아래 접이식으로).

## URL 상태 (validateSearch, zod)

```
group[] (기본 ["discipline"])
discipline[] plot[] team[] hdecPic[] hdecEng[]
bucket=day|week
stageView[]  asofMode=today|dataDate  planMode=baseline|remaining
range=14|30|60|90|180  hidePast=bool  q=string
leaderboardDim=team|hdec_pic|hdec_eng
```

## 인터랙션

- Delay Top N 행 클릭 → `/closure/task-management/raw-data`로 이동, `source=dashboard`, `taskNo` 또는 `q`로 필터, 기존 필터 리셋(SM/ABD Progress 매트릭스 로직과 동일).
- Owner Leaderboard 행 클릭 → 해당 dim 값으로 Raw Data 필터.
- Matrix 셀 클릭 → 기존 로직 유지.

## 접근성/성능

- 모든 위젯은 `useMemo`로 aggregate 재사용, Matrix는 기존대로 가상화.
- 12주 트렌드는 미리 정렬된 배열만 계산 후 Recharts에 전달.
- 색상은 모두 semantic token (primary/success/warning/destructive), 다크 모드 안전.

## 파일 변경 요약

- 신규: 라우트 1, 페이지 1, 위젯 5, 유틸 1
- 수정: `AppLayout.tsx`(사이드바 항목), `useTaskDashboardData.ts`(hdecPic/hdecEng 인자), 기존 KPI/Matrix는 재사용

승인해 주시면 이 구성대로 구현하겠습니다.