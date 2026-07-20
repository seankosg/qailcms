## 목적
TM 대시보드의 담당자 Leaderboard와 그 팝업(OwnerDetailDialog)의 UX를 다음처럼 개선한다.

1. Leaderboard 카드 자체를 Collapsible로 감싸 접기/펼치기 가능, **기본값=접힘**.
2. 팝업의 "Raw Data 열기" 버튼이 지연 항목만 정확히 필터링해 Raw Data 페이지로 이동. 이동 시 기존 Raw Data 필터는 리셋되고 새 필터만 적용(SM/ABD의 `source=progress` 패턴을 TM에 이식).
3. 팝업의 "지연 Top 50" 테이블 컬럼을 다음으로 확장:
   `공종 · Team · Task · Stage · HDEC PIC · 계획일 · 지연일 · 계획진도율 · 실제진도율 · 차이 · 판정`
   - Team 컬럼은 sticky-left로 스크롤해도 항상 표시.
4. 위 테이블의 모든 헤더에 정렬 아이콘 추가, **Shift+클릭으로 다중정렬** 지원.

## 변경 파일

### 1. `src/components/task-management/dashboard/OwnerLeaderboardCard.tsx`
- `@/components/ui/collapsible`의 Collapsible/CollapsibleTrigger/CollapsibleContent 로 카드 본문 감싸기.
- 내부 상태 `open` (기본 `false`) + 트리거에 ChevronDown/Right 아이콘, "N명"의 표시 유지.
- 헤더 우측의 검색/탭 컨트롤은 열림 상태에서만 표시(접힘일 때는 요약만).

### 2. `src/lib/task-management/delay-utils.ts` — `DelayTopItem` 확장
현재:
```
id, taskNo, taskName, discipline, team, hdecPic, hdecEng, stage, plannedDate, daysLate, judgment, actualProgress
```
추가 필드:
- `planPct: number` — 해당 태스크의 스테이지 기준 계획진도율(asOfDate까지 계획상 완료돼야 하는 스테이지 수 / 전체 스테이지 수 × 100).
- `actualPct: number` — 실제 완료 스테이지 수 / 전체 스테이지 수 × 100 (= `actual_progress`가 있으면 그 값을 우선).
- `diffPp: number` — `actualPct − planPct`.

`computeDelayTopN`에서 각 항목별로 `ALL_TASK_STAGE_KEYS` 순회하며 planned/done 카운트 산출해 세 필드 채움. 기존 필드는 그대로 유지.

### 3. `src/components/task-management/dashboard/DelayTopTable.tsx` — 컬럼 확장 + 정렬
- 컬럼 스키마: 공종, Team(sticky), Task, Stage, HDEC PIC, 계획일, 지연일, 계획진도율, 실제진도율, 차이(pp), 판정.
- Team 헤더/셀에 `sticky left-0 z-10` + 불투명 배경(mem 규칙: `bg-card` 두 겹 gradient로 뒷 컬럼 비침 방지).
- 다중정렬 상태: `const [sortKeys, setSortKeys] = useState<Array<{key, dir}>>([])`.
  - 헤더 클릭: 단일 정렬로 대체(같은 키면 asc→desc→해제 순환).
  - Shift+클릭: 기존 배열에 추가/토글.
  - 헤더에 우선순위 번호(1,2,3…)와 방향 화살표(ChevronUp/Down) 표시.
- 정렬은 클라이언트 정렬(useMemo). `limit` prop은 정렬 후 slice.

### 4. `src/components/task-management/dashboard/OwnerDetailDialog.tsx`
- `goRawData()` 로직 교체:
  - 담당자 dim/키 + `source: "dashboard"` + `mode: "delay"` 를 search에 세팅.
  - asOfDate도 함께 전달(`asOf: asOfDate`)해 Raw Data에서 동일 기준 지연 판정.
- DelayTopTable에 확장된 items 그대로 전달(computeDelayTopN 결과에 새 필드 포함됨).

### 5. `src/routes/_authenticated/closure/task-management/raw-data.tsx`
- `validateSearch`(zod) 추가: `source`, `mode`, `team`, `hdec_pic_name`, `hdec_eng_name`, `asOf` 옵션.

### 6. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` — 대시보드 진입 시 필터 리셋+적용
- `Route.useSearch()`로 search 읽기.
- 마운트 후 1회, `search.source === "dashboard"`이면:
  - `setColumnFilters([])`, `setGlobalFilter("")`, `setSearchInput("")` 로 저장된 필터 리셋.
  - 이후 다음 필터를 강제 세팅:
    - dim 파라미터에 따라 team/hdec_pic_name/hdec_eng_name 중 하나에 대해 `columnFilters`에 `{id, value: [key]}` 추가.
    - `search.mode === "delay"`이면 파생: 각 행의 스테이지 중 하나라도 `isTaskStageDelayedAsOf(item, st, asOf)` 인 항목만 통과하도록 필터 적용.
  - 안전을 위해 `useRef` 가드로 최초 1회만 수행(그 후 사용자가 필터를 변경할 수 있게 함).
- 리셋+적용이 저장 프리퍼런스로 덮여 쓰이지 않도록 `stateLoaded` 이후 실행하고, 저장을 다음 tick으로 지연.

## 기술 상세

- 다중정렬 비교기: `sortKeys`를 순회하며 최초 non-zero 결과 반환. 문자열은 `localeCompare("ko")`, 숫자는 산술 비교, 날짜는 문자열 ISO 그대로 비교.
- Team sticky 컬럼: `<th class="sticky left-0 z-20 bg-muted">` / `<td class="sticky left-0 z-10 bg-card">` — 스티키 반투명 이슈 방지 위해 `bg-card` + `before:absolute before:inset-0 before:bg-card` 이중 배경(mem://design/sticky-columns-opaque 규칙).
- Collapsible 접힘 상태에서도 카드 헤더에는 dim 뱃지(현재 선택된 dim) + "지연 태스크 N개" 요약 표시.
- Raw Data 지연 필터: 스테이지별 지연 판정은 클라이언트에서 이미 계산 가능(`computeDelayTopN` 로직과 동일한 `isTaskStageDelayedAsOf`). 서버 페이징이므로 리소스 절감 위해 대시보드 진입 시 페이지 크기를 max로 하지 않고, 클라이언트 필터 함수(filter-fns.ts)에 delay-mode 훅을 추가.

## 미포함(기존 유지)
- 서버 스키마, RLS, 대시보드의 다른 카드/차트, KPI, 주간 트렌드는 손대지 않음.
- `computeOwnerLeaderboard` 인터페이스 유지.
