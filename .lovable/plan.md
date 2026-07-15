# ABD Raw Data — PLOT C/D 필터 토글 추가

Team 탭(MECH/ELEC/ARCH…) 왼쪽에 PLOT C / PLOT D 토글을 배치하고, 선택 상태에 따라 하부 상태별 통계(All/Approved/In-progress/Not-started) 카운트와 테이블 행이 모두 연동되도록 합니다.

## 동작 사양

- 초기값: **All Plots**(전체). URL `plot` 파라미터 부재 시 필터 미적용.
- 토글 옵션: `All` / `C` / `D` — 하나만 선택 가능한 세그먼트 탭.
- URL 상태 반영: `?plot=C|D` (All이면 파라미터 생략). 페이지 이동/공유 시 상태 유지.
- Team 탭 · Status 탭 · 서버 필터 · 검색어와 AND로 결합.
- Team 전환 시 plot 선택은 유지 (사용자가 직접 해제할 때까지).

## 변경 범위

### 1) DB 마이그레이션 — 3개 RPC에 `_plot` 파라미터 추가

신규 마이그레이션 1개로 아래 3개 함수를 `CREATE OR REPLACE`:

- `abd_items_search(..., _plot text DEFAULT NULL, ...)` — `_where`에 `plot = _plot` 조건 추가
- `abd_items_counts(_team, _include_inactive, _plot text DEFAULT NULL)` — WHERE에 `(_plot IS NULL OR plot = _plot)` 추가
- `abd_items_facets(_column, _team, _status_group, _include_inactive, _plot text DEFAULT NULL)` — `_where`에 동일 조건 추가

`_plot`은 `'C' | 'D' | NULL`만 유효. NULL이면 필터 미적용.

### 2) 클라이언트 훅 — `src/hooks/useAbdItems.ts`

- `AbdItemsQueryParams` / `useAbdCounts` opts / `useAbdFacet` opts에 `plot?: "C" | "D" | null` 추가
- 각 RPC 호출에 `_plot: p.plot ?? null` 전달
- `queryKey`에 자동 포함(객체 통째로 사용 중이라 자동 반영됨)

### 3) 라우트 검색 스키마 — `src/routes/_authenticated/closure/abd/raw-data.tsx`

`abdRawDataSearchSchema`에 다음 추가:

```ts
plot: fallback(z.enum(["all","C","D"]), "all").default("all"),
```

### 4) 페이지 UI — `src/components/abd/raw-data/AbdRawDataPage.tsx`

- `urlSearch.plot`를 읽어 `plotFilter: "C" | "D" | null` 계산 (`"all"` → null)
- `useAbdItemsQuery` / `useAbdCounts` / `useAbdFacet` 호출에 `plot: plotFilter` 전달
- Team `<Tabs>` 바로 왼쪽에 새로운 `<Tabs value={urlSearch.plot} onValueChange={(v)=>setUrl({plot:v, page:1})}>` 배치:
  - `All Plots` / `PLOT C` / `PLOT D`
  - 기존 Team 탭과 같은 `h-9` 높이의 `TabsList`, 시각적 구분을 위해 오른쪽에 얇은 세로 구분선(`border-l`)
- 레이아웃: Team Tabs 라인을 `flex items-center gap-3`로 감싸 왼쪽=Plot, 오른쪽=Team 순 배치 (기존 Team 탭 순서/스타일은 유지)
- `viewPref` 키는 그대로 유지 (팀 단위 저장, plot은 세션 필터로만 취급)
- `filenamePrefix`: plot 선택 시 `abd-${team}-plot${plot}` 로 확장

### 5) 검증

- `tsgo --noEmit` 통과
- 스모크:
  1. All Plots → 카운트/테이블 = 기존 값 그대로 (회귀 없음)
  2. PLOT C 선택 → All/Approved/In-progress/Not-started 카운트가 C 한정으로 감소, 테이블도 C만 표시
  3. PLOT D 선택 → 마찬가지로 D 한정
  4. Team 전환 시 plot 유지, URL에 반영
  5. 컬럼 filter dropdown facet(plot 컬럼 제외한 서비스/PIC 등)도 plot 필터 적용된 값으로 표시

## 비변경 사항

- ABD 이외 도메인(Snag/Task/SP) UI 변경 없음
- `abd_items_raw` 스키마·컬럼 변경 없음
- 기존 Team 탭·Status 탭·검색/필터/정렬 동작은 그대로

