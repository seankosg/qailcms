## 목표
Task Tree의 Main Task 헤더 및 Subtask 행의 오른쪽 끝(현재 시계 아이콘 자리)에 **계획(파랑) vs 누계 실적(빨강)** 미니 라인차트 표시. 클릭 시 팝업으로 대형 차트. 미니차트는 도하 05:00에 서버가 사전 계산한 캐시만 표시(로딩 시 재계산 없음). 팝업 오픈 순간에만 해당 항목을 즉시 재계산.

## 계획선 규칙 (핵심 명확화)
- **계획선은 Data Date와 무관하게 `plan_start` ~ `plan_end` 전 구간을 사전 계산해 그린다.**
- Data Date 이후 구간도 원래 계획 종료일까지 이어져서 100%에 도달하는 곡선이 완결된 형태로 보여야 한다.
- 계산식: `t ∈ [plan_start, plan_end]` 을 균등 24포인트로 샘플링, 각 포인트에서 `planned% = (t - plan_start) / plan_days` (0~1, clip). `plan_days` 없으면 `plan_end - plan_start`.
- 결과적으로 X축 범위는 `min(plan_start, actual_start)` ~ `plan_end` (실적이 plan_end 를 넘어 진행 중이면 `max(plan_end, data_date)`).

## 실적선 규칙
- `task_management_status_history` 에서 `field='actual_progress'` 인 로그를 시간 오름차순으로 수집 → 각 시점 `new_value` 를 stepped-forward 로 이어붙임.
- 시작점: `actual_start` 가 있으면 그 날짜에 0, 없으면 첫 로그 이전 구간은 그리지 않음.
- 끝점: `data_date` (또는 최신 갱신 시각)에서 현재 `actual_progress`.
- Data Date 이후는 실적선을 그리지 않음(계획선만 이어짐).

## DB 변경 (마이그레이션 1개)
1. `public.task_progress_chart_cache`
   - `id uuid pk`, `discipline text`, `task_no text`, `updated_at timestamptz default now()`,
     `plan_points jsonb`(형식: `[{d:'YYYY-MM-DD', v:0.00..1.00}]`),
     `actual_points jsonb`(동일 형식),
     `x_start date`, `x_end date`,
     `last_actual_progress numeric`, `last_plan_progress numeric`
   - `unique(discipline, task_no)`
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_progress_chart_cache TO authenticated;`
   - `GRANT ALL ON public.task_progress_chart_cache TO service_role;`
   - RLS ENABLE + policy: authenticated SELECT 허용, 쓰기는 service_role 만 (definer 함수 통해서만).
2. `public.recalc_task_progress_charts(_discipline text default null)` SECURITY DEFINER
   - `task_management_raw` 전체(또는 공종) 순회
   - 계획선: 위 규칙대로 24포인트 (Data Date 무관, plan_end 까지 완결)
   - 실적선: status_history 조회 → 계단식 24포인트로 리샘플링 (기간 균등 나누기, 각 구간의 마지막 값)
   - `upsert` on `(discipline, task_no)`
3. status_history 에 `actual_progress` 로그가 부족한 오래된 행 대응: 함수 내에서 로그가 없거나 1개 이하면 폴백으로 `[{actual_start,0}, {data_date, actual_progress}]` 2포인트 사용.
4. pg_cron: `daily-task-progress-recalc` — `0 2 * * *` UTC (= Doha 05:00) → `SELECT public.recalc_task_progress_charts(NULL);`

## 서버 함수
`src/lib/task-management/progress-chart.functions.ts`
- `getTaskProgressChartsBulk({ discipline })` — 캐시 테이블에서 해당 공종 모든 행 반환. Task Tree 진입 시 1회.
- `getTaskProgressChartDetail({ discipline, task_no })` — 캐시 무시하고 위 계산 로직을 **60포인트** 로 실시간 재계산 후 반환. 팝업 오픈 시.
- `recalcTaskProgressChartsNow({ discipline? })` — 관리자 수동 트리거(선택).

## UI 변경
### `TaskTreePage.tsx`
- `useQuery(['task-progress-charts', discipline])` 로 bulk 조회 → `chartMap`.
- Main Card 헤더 우측 `History` 아이콘 자리를 `<MiniProgressChart>` 로 교체.
- Subtask row 우측 `History` 아이콘 자리도 동일 컴포넌트로 교체.
- 기존 이력 보기(HistoryDrawer) 는 팝업 내부 보조 버튼으로 이동해 기능 유지.

### 신규 컴포넌트
1. `MiniProgressChart.tsx` — **고정 120×32 px** 순수 SVG. path 2개:
   - 계획: `stroke: hsl(215 90% 55%)` (파랑) 실선
   - 실적: `stroke: hsl(0 80% 55%)` (빨강) 실선
   - 데이터 없으면 회색 dashed placeholder + `-`
   - cursor:pointer, `title` 툴팁으로 최신 Plan%/Actual% 요약. 클릭 → 팝업 오픈.
2. `TaskProgressChartDialog.tsx` — shadcn `Dialog`, 내부 Recharts `LineChart` 640×320.
   - X: date, Y: 0~100%, grid, legend
   - Plan(파랑 실선), Actual(빨강 실선), Data Date 수직 참조선
   - 오픈 시 `getTaskProgressChartDetail` (react-query, `staleTime: 0`, `enabled: dialogOpen`)
   - 헤더: Task No · Task Name · 갱신 시각 · "이력 보기" 버튼 (기존 HistoryDrawer 재사용)

## 관리자 화면 (최소)
`/admin` 페이지에 "Task 진도율 차트 지금 재계산" 버튼 추가 → `recalcTaskProgressChartsNow`.

## 성능
- 캐시 bulk 조회: 공종당 수천 행 × 48 point JSON ≈ 수 MB 이내, 단일 SELECT.
- 로딩 경로에서 서버 재계산 0회 (네트워크 탭으로 검증).
- 팝업 재계산은 단건이라 즉시 응답.
- 크론 재계산은 공종 무관 일괄, plan 곡선은 순수 산술이라 빠르며 실적 곡선 조회만 status_history 인덱스 (`discipline, task_no, field, changed_at`) 로 처리.

## 검증 체크리스트
- [ ] plan_end 가 미래여도 계획선이 plan_end 시점에 100% 로 완결.
- [ ] Data Date 가 plan_end 이전이어도 계획선은 그 이후 구간까지 사전 계산된 값으로 표시.
- [ ] 실적선은 Data Date 를 넘어 그리지 않음.
- [ ] 미니차트 폭/높이는 기간 무관 120×32 고정.
- [ ] Task Tree 재로딩 시 detail 서버 함수 호출 0회.
- [ ] 팝업 오픈 시 detail 호출 1회.
- [ ] `SELECT * FROM cron.job WHERE jobname='daily-task-progress-recalc';` 등록 확인.

승인해 주시면 마이그레이션 → 서버 함수 → UI 순으로 구현합니다.
