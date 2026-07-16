## 목표

Snag List Management 모듈에 **Progress 페이지**를 신설해 Raw Data 위에 위치시키고, SHAW PROJECT CMS의 `DefectProgressPage` 매트릭스(Start · Completion · Closure 3-Stage × Plan/Actual × Daily/Weekly 버킷)를 동일 UI로 이식합니다. 미종결 최대 **10만 건**까지 안정 렌더를 보장하기 위해 **서버측 사전 집계 RPC** 를 이번 릴리스에 포함합니다. 필터는 Snag Dashboard와 동일한 **Plot · Team · Room Group** + SHAW의 **Group · Bucket · Stage · Range · Hide past · As-of · Plan mode** 를 그대로 재사용. Excel 내보내기는 범위 외.

## 성능 아키텍처 (핵심)

- DB에서 매트릭스 셀·누적치를 직접 GROUP BY 해 반환. 10만 건이라도 셀 수는 (그룹 수 × 버킷 수 × 3 스테이지) 로 수백~수천 행 → 네트워크·클라이언트 부담 상수화.
- RPC 2종:
  1. **`defect_snag_progress_matrix(_plan_groups, _teams, _room_groups, _group_by_json, _bucket, _range_start, _range_end, _as_of_date, _plan_mode)`**
     - 반환: `group_key text[], bucket_iso date, stage text, plan_cnt int, actual_cnt int, plan_upto int, actual_upto int, done_upto int, total int`.
     - `stable`, `SECURITY INVOKER` — 미종결 조건 + 필터 스캔 후 `date_trunc('week', ...)` 또는 원본 일자 버킷화, `_group_by_json` 순서대로 그룹 키 생성.
     - `_plan_mode='remaining'` 이면 `_as_of_date` 시점 이미 완료된 stage는 plan 카운트 제외.
  2. **`defect_snag_progress_kpi(_plan_groups, _teams, _room_groups, _as_of_date, _plan_mode, _stage_filter)`**
     - 반환: `cum_plan, cum_actual, done_stages, total_stages, overdue, upcoming_7`.
- 헬퍼: `_snag_stage_done(row jsonb, stage text)` — `actual_progress_pct` normalize 포함.
- 인덱스 추가(부분): `(is_active, actual_closure_date, plan_group, team)` + 각 planned/actual 일자 개별 인덱스.
- `GRANT EXECUTE ON FUNCTION ... TO authenticated`.
- 미종결 정의: `is_active = true AND actual_closure_date IS NULL AND coalesce(closure_status,'') <> 'Closed'`. 서버측 고정.

## 라우트 · 네비게이션

- 신규 파일: `src/routes/_authenticated/closure/snag-management/progress.tsx`
  - `validateSearch`(zodValidator + fallback):
    - Snag Dashboard 호환: `plot("C"|"D")`, `teams`(CSV), `roomGroups`(CSV).
    - SHAW 매트릭스: `bucket("day"|"week")`, `stageView`(CSV), `groupBy`(CSV, 9종), `range`(30/60/90/180), `hidePast`(0/1), `asofMode("dataDate"|"today")`, `planMode("baseline"|"remaining")`.
- `AppLayout.tsx` Snag 메뉴 순서: **Dashboard → Progress → Raw Data → Import → Settings**.

## 서버 함수

- 신규 파일: `src/lib/defect-management/progress.functions.ts` (`requireSupabaseAuth`).
  - `getSnagProgressMatrix(...)` → RPC 호출 후 정규화.
  - `getSnagProgressKpi(...)` → RPC 호출.

## 클라이언트 유틸

- 신규 파일: `src/lib/defect-management/progress-utils.ts`
  - 타입: `Stage`, `Bucket`, `GroupBy`(9종), `PlanMode`.
  - `buildBucketRange`, `formatBucketLabel`, `weekStartIso`, `assembleMatrix(rows, options)` — DB 집계 결과를 SHAW `DefectAggregateResult` 호환 형태로 조립. Group by 다중 선택 시 " · " 로 결합 라벨.

## UI 컴포넌트

- 신규: `src/components/defect-management/progress/SnagScheduleMatrix.tsx`
  - SHAW `DefectScheduleMatrix.tsx` 포팅. `@tanstack/react-virtual` 로 우측 timeline 컬럼 가상화.
  - **스티키/불투명 규칙** (프로젝트 core memory 준수):
    - 상단 헤더 영역 (`Timeline` 헤더 + 버킷 라벨 행): `position: sticky; top: 0; z-index: 30` + `bg-card` 완전 불투명 배경. 매트릭스 내부 세로 스크롤 시 항상 상단 고정.
    - 좌측 sticky 블록(Group · Total Scope · Up to as-of): `position: sticky; left: 0; z-index: 40` + `bg-card` 불투명. 필요 시 `linear-gradient(hsl(var(--card)),hsl(var(--card))), linear-gradient(hsl(var(--card)),hsl(var(--card)))` 이중 스택으로 뒤 컬럼이 절대 비치지 않게 처리 (mem://design/sticky-columns-opaque 규칙).
    - 좌상단 교차 영역은 `z-index: 50` 로 최상위, 불투명 배경 유지.
    - 좌측 스티키 폭: `STICKY_LEFT_WIDTH = W_GROUP + W_TOTAL_BLOCK + W_PLAN_BLOCK` (SHAW 상수 그대로).
    - 우측 timeline 은 헤더와 본문이 별도의 가로 스크롤 컨테이너를 갖고, `scrollLeft` 를 서로 동기화(SHAW의 `syncingRef` 로직 이식). 좌측 sticky 본문은 세로 스크롤을 우측 본문과 동기화(`scrollTop` mirroring + `wheel` 핸들러).
    - 매트릭스 컨테이너 최대 높이: `max-h-[calc(100vh-320px)]` — Progress 페이지 툴바·KPI를 고려해 조정.
  - 하위 셀은 기존 `src/components/schedule/ScheduleCell.tsx` 재사용.
- 신규: `src/components/defect-management/progress/SnagProgressPage.tsx`
  - 헤더 + 부제(Data Date / Today / Plan mode).
  - **필터 툴바(Card)** — SHAW 툴바 레이아웃 그대로:
    - **Plot** (라디오 C/D).
    - **Team** — `DeSnagToolbar` 재사용.
    - **Room Group** — `DeSnagRoomGroupFilterBar` 재사용.
    - **Group** — `All` + `ToggleGroup type="multiple"` 9종. 순서 유지, 최소 1개.
    - **Bucket** — `ToggleGroup type="single"` (Day/Week).
    - **Stage view** — ToggleGroup 다중(Start/Comp/Close), 최소 1개.
    - **Range** — Select (30/60/90/180일).
    - **Hide past** — Switch.
    - **As-of** — ToggleGroup single (Data Date / Today).
    - **Plan mode** — ToggleGroup single (Baseline / Remaining).
  - KPI Strip: Cumulative Plan / Actual / Variance / Overdue / Upcoming 7d / Progress %.
  - 매트릭스 렌더.
  - 셀 클릭 → `/closure/snag-management/raw-data` 로 이동, `plot / team / roomGroup / stage / dateField / dateStart / dateEnd` + 그룹 차원별 파라미터(subcontractor/subsub/hdecPic/hdecEng/level/mainTrade/subTrade/workType) 채움.

## 데이터 획득 흐름

- `useServerFn` + `useQuery` 두 개:
  - `["snag-progress-matrix", plot, teams, roomGroups, groupBy, bucket, rangeStart, rangeEnd, asOfDate, planMode]`
  - `["snag-progress-kpi", ...]`
- `staleTime: 60_000`, `refetchOnWindowFocus: false`.

## 필터 연동 규칙

- **Plot / Team / Room Group** URL 파라미터가 Snag Dashboard와 동일 → 페이지 간 이동 시 지속.
- **Group / Bucket / Stage / Range / Hide past / As-of / Plan mode** 는 URL 로컬 상태.
- **Unclosed** 는 RPC 내부에서 고정 필터.

## 마이그레이션

- 함수: `_snag_stage_done`, `defect_snag_progress_matrix`, `defect_snag_progress_kpi` (모두 SECURITY INVOKER).
- 인덱스: 미종결 부분 인덱스 + planned/actual 일자 인덱스.
- `GRANT EXECUTE ... TO authenticated`.

## 파일 목록

- 추가:
  - 마이그레이션 SQL (RPC 2종 + 헬퍼 + 인덱스)
  - `src/routes/_authenticated/closure/snag-management/progress.tsx`
  - `src/lib/defect-management/progress.functions.ts`
  - `src/lib/defect-management/progress-utils.ts`
  - `src/components/defect-management/progress/SnagProgressPage.tsx`
  - `src/components/defect-management/progress/SnagScheduleMatrix.tsx`
- 수정:
  - `src/components/layout/AppLayout.tsx` (Snag 메뉴에 Progress 링크 추가, Raw Data 위 배치)

## 향후 (범위 외)

1. Excel(Matrix / Rows) 내보내기 이식.
2. Critical Watchlist / Lagging Groups 패널.
