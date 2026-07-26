# TM KPI ↔ Raw Data 정합성 — SHAW 방식 단순화

## 현재 상태 확인 (root cause)

- **Dashboard 데이터 흐름**: `src/hooks/useTaskDashboardData.ts:18` 에서 `team`, `discipline`, `plot`, `hdecPic`, `hdecEng`, `q` 를 서버 쿼리에 적용한 뒤, `TmDashboardPage.tsx:113` 에서 과거 Data Date 시 `tm_judge_at_date` 를 병합하고, `TmKpiCards.tsx:64` 에서 `computeKpi()` 로 KPI 를 계산. KPI 값은 **이미 필터된 데이터 + Data Date 재판정** 위에서 나온다.
- **Raw Data 데이터 흐름**: `TaskManagementRawDataPage.tsx:453` 에서 **전체 행**(`select("*")` + 1,000건 페이징)을 가져온 뒤, `kpiSelection`(`TaskManagementRawDataPage.tsx:567`) 이 먼저 실행되고, 그 다음 `columnFilters`로 팀/담당자 등이 필터링. 이 때문에:
  - KPI 카드(51) = Dashboard 의 필터 후 집계
  - `kpiSelection` 매치(61) = KPI 조건 만족하는 전체 팀 행
  - 테이블 행(27) = 매치에 팀 컬럼 필터 추가 적용
  - 컨텍스트 Sub(+6) = 별도 추가 병합 로직
  이렇게 **4단계 필터 게이트**가 서로 다른 시점에 적용되어 숫자가 어긋남.

## SHAW 가 해결한 방식 (확인된 사실)

`src/components/defect-management/dashboard/DeSnagDashboardPage.tsx:117` 의 `goRaw`:
- 이미 적용 중인 Dashboard 필터(`team`, `roomGroup`, `plan_group`)를 그대로 query string 에 실음.
- KPI/셀 클릭 시에는 **status = "Open" 같은 실제 컬럼 값**만 추가로 덧붙임.
- Raw Data 는 이 query string 을 컬럼 필터로 해석하여 **이미 동일한 유니버스**에서 추가 필터만 적용 → 카드값 = 행 수.

TM 에도 동일 원칙을 적용하면 됨.

## 수정 방향 (UI 변경 최소화)

### 삭제할 것
- `TaskManagementRawDataPage.tsx` 의 `delayMode`, `kpiMode`, `kpiSelection`, `delayFilteredRows`, `kpiFilteredRows`, `hideContextSubs`, "매치/컨텍스트 Sub" 배지 및 토글.

### 유지할 것 (UI 변경 억제)
- Dashboard → Raw Data URL 은 그대로 `mode`, `asOf`, `taskScope`, `team`, `discipline`, `plot`, `hdec_pic_name`, `hdec_eng_name`, `q` 를 사용. 주소창 변화 없음.
- Raw Data 헤더는 기존 `X / Y` 형식 유지. 단, **"매치 · 컨텍스트" 배지만 제거**.

### 핵심 변경
Dashboard 에서 넘어온 `mode`를 내부에서 **TanStack `ColumnFilters`로 변환**해 `columnFilters` 초기값에 한꺼번에 넣는다. 그러면:
- KPI 조건(`auto_judgment`, `plan_start`, `plan_end`, `actual_start`, `actual_progress`)과
- ownerContext 필터(`team`, `discipline`, `plot`, `hdec_pic_name`, `hdec_eng_name`, `q`)
- `taskScope`(`level`)

모두 테이블의 필터 모델에 들어가 **한 번에 적용**. 이후 `getFilteredRowModel()`의 결과가 곧 카드값이 됨.

### `mode` → 컬럼 필터 매핑

| Dashboard 카드/세그먼트 | 변환된 컬럼 필터 | 이유 |
|---|---|---|
| completed | `auto_judgment: ['완료']` 또는 `actual_progress: [1, 1]` | `isCompleted` 와 동일 |
| wip | `actual_start: NOT_EMPTY` + `auto_judgment: ['정상','주의','지연','악화']` | started & not completed |
| not_started | `actual_start: EMPTY` + `auto_judgment: ['정상','주의','지연','악화']` | not started & not completed |
| planned_started | `plan_start: ≤ asOf` | `isPlannedStartedBy` |
| actual_started | `actual_start: NOT_EMPTY` | `isStarted` |
| in_delay / behind | `auto_judgment: ['지연','악화']` | `isInDelay`/`isBehindSchedule` 동일 |
| start_delayed | `auto_judgment: ['지연','악화']` + `actual_start: EMPTY` + `plan_start: ≤ asOf` | InDelay ∩ StartDelayed |
| completion_overdue | `auto_judgment: ['지연','악화']` + `plan_end: < asOf` | InDelay ∩ CompletionOverdue |
| critical | `auto_judgment: ['악화']` | Critical = 악화 |
| taskScope | `level: ['main']` 또는 `['sub']` | `scopeItems` 동일 |

- Data Date 일치: `asOf` 값을 `useTmDataDate` 의 공유 상태로 설정하고, `useTmJudgmentAtDate` 결과를 행에 병합. Dashboard 의 `effectiveItems` 병합과 완전히 동일한 방식으로 `auto_judgment` 등을 asOf 시점으로 재판정.

## 영향 파일

1. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
   - `kpiMode`, `delayMode`, `kpiSelection`, `delayFilteredRows`, `kpiFilteredRows`, `hideContextSubs` 상태 및 JSX 삭제.
   - `mode → ColumnFilters` 변환 함수 추가.
   - Dashboard 딥링크 `useEffect`에서 `columnFilters` 초기값에 KPI 필터 포함.
   - `useTmJudgmentAtDate` + `mergeTmJudgment` 도입하여 Data Date 재판정.
   - "매치 · 컨텍스트 Sub" 배지/토글 제거.
2. `src/components/task-management/dashboard/TmKpiCards.tsx`
   - 변경 없음. 기존 `mode`/`asOf`/`taskScope`/`ownerContext` 전달이 그대로 사용됨.
3. `src/routes/_authenticated/closure/task-management/raw-data.tsx`
   - 변경 없음. 기존 search schema 가 SHAW 방식의 ownerContext 필터를 이미 수용함.

## UI 변경 정리

- **Raw Data 헤더**: 기존 `27 / 1,440` 유지. "매치 61건 · 컨텍스트 Sub 6건" 배지 삭제.
- **URL**: 주소창에 `mode=behind` 등 기존 파라미터 그대로 유지.
- **테이블 행**: KPI 카드 숫자(51)와 정확히 일치하게 됨.
- **Data Date**: Raw Data 진입 시 Dashboard 와 동일한 Data Date가 자동 선택됨.

## 검증 시나리오

1. Dashboard: Team=ELEC, Behind 클릭 → Raw Data: 헤더 `51 / 1,440` (기존 `27 / 1,440`와 다른 값이 정답).
2. Dashboard: 필터 없음, In Delay 클릭 → Raw Data: 카드값과 동일한 행 수 표시.
3. Dashboard: 과거 Data Date 선택, Critical 클릭 → Raw Data: Data Date가 동일하게 설정되고 `auto_judgment='악화'` 필터 결과가 Dashboard 와 일치.
4. Raw Data 진입 후 사용자가 추가로 컬럼 필터를 조작하면, 그 값은 `columnFilters`에 누적되어 `표시 / 전체`만 변하고 Dashboard 기준 값은 보존됨.
