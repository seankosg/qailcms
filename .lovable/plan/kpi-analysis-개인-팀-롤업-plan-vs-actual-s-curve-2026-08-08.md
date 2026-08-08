# KPI Analysis — 개인/팀 롤업 Plan vs Actual S-Curve

Individual Progress 차트 바로 아래에, SM Progress 페이지의 "Plan vs Actual — S-Curve" 카드와 동일한 UI/구성으로 TM 진도율 곡선을 추가한다.

## 무엇을 만드는가

- 접기/펼치기 가능한 카드 1개 (SM Progress 카드와 동일한 헤더·KPI 스트립·차트·하단 Variance 막대 구성).
- 상단 막대(일일 증분) + 누계 선(Plan 점선 / Actual 실선) 조합, Today(=As of) 기준선, 범례 클릭 토글.
- 하단에 Δ(Actual − Plan) 막대 차트 (음수 빨강 / 양수 초록).

## 동작 규칙 (확정)

- **대상**: 기본은 현재 상단 필터(전체·팀·개인 pill 포함) 모집단 전체를 롤업한 1쌍의 곡선. 카드 내 대상 셀렉터 또는 Individual Progress 막대 클릭으로 특정 팀/개인을 고르면 그 대상만의 곡선으로 전환된다. 선택 상태는 URL 검색 파라미터에 보관해 새로고침·공유 시 유지된다.
- **수치 단위**: 진도율 % — 대상 과업의 단순 평균(Individual Progress 막대의 planPct/actualPct와 동일 정의). 일일 막대는 누계의 일별 증분(pp).
- **버킷**: Daily / Weekly / Monthly 토글, 기본 Weekly.
- **Plan 곡선**: 각 과업의 plan_start~plan_end 선형 계획(기존 정본 계산 함수)을 버킷 경계일마다 평가한 뒤 평균.
- **Actual 곡선**:
  - 저장된 일자별 실적 스냅샷이 있는 구간 = 실측값 그대로, **실선**.
  - 스냅샷이 없는 구간 = 앞뒤 앵커를 잇는 2점 직선으로 선형 역산, **옅은 점선 세그먼트**로 구분 표기.
  - 앵커 규칙: 시작 = actual_start(없으면 plan_start)에서 0, 끝 = actual_finish면 100%, 아니면 관측일의 현재 실적. As of 이후 구간은 그리지 않음(null).
- **As of 연동**: 상단 As-of 값 변경 시 곡선의 우측 절단 지점과 KPI 값이 함께 이동한다.

## 검산 (자체 점검)

- 마지막 표시 버킷의 Cum Plan% / Cum Actual% 가 Individual Progress 요약 수치와 일치해야 한다(±0.1pp). 카드 KPI 스트립에 P / A / Δ 를 같은 값으로 표시해 눈으로 대조 가능하게 한다.
- 대상 과업 수를 카드에 표시해 모집단(필터 결과 건수)과 일치하는지 확인한다.

## 기술 상세

- 신규 `src/lib/task-management/scurve-utils.ts`
  - `buildTmSCurve({ items, asOf, bucket })` → `{ buckets, bucketLabels, todayIndex, dailyPlan[], dailyActual[], cumPlan[], cumActual[], measuredMask[] }`.
  - Plan 은 `derived.ts` 의 `cumPlanProgress` 를 버킷 경계일에 재사용(자체 산식 추가 금지).
  - Actual 은 과업별 스냅샷 포인트 배열을 시간축에 매핑 후 결측 구간 선형 보간, `measuredMask` 로 실측/역산 구분.
- 실적 스냅샷 소스: `task_progress_chart_cache.actual_points` (일부 과업은 다점 이력 보유). 기존 `useTaskProgressSnapshot` 훅에 포인트 배열 노출용 반환값을 **추가**만 하고 기존 API·호출부는 그대로 둔다.
- 신규 컴포넌트 `src/components/task-management/dashboard/TmPlanVsActualCard.tsx`
  - recharts `ComposedChart` + `ChartContainer`/`ChartTooltip`, Collapsible — `SnagPlanVsActualCard.tsx` 구조를 그대로 따른다.
- `TmKpiAnalysisPage.tsx` 에 카드 배치(Individual Progress 바로 아래) 및 검색 파라미터 `curveDim`, `curveKey`, `curveBucket` 추가(라우트 `kpi-analysis.tsx` 스키마에 `fallback` 기본값으로).
- 색상은 기존 디자인 토큰(primary / muted-foreground / destructive / success)만 사용.
- 서버·DB 변경 없음. TM Dashboard 및 다른 모듈 UI는 건드리지 않는다.
