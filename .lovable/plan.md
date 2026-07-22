# SM Raw Data 필터 카운트가 전체보다 큰 원인 및 수정 계획

## 재현된 현상

- 상단 chip: `Active column filters: Start Status: Done` (파생 컬럼 필터 적용됨)
- 표 헤더: `8,470 records` — 서버 조회는 정상적으로 Start Status=Done을 반영
- Team 컬럼 필터 드롭다운: `ARCH 28,832 / ELEC 9,232 / MECH 9,991` → **합계 48,055** (= Unclosed 탭 전체 건수)
- 즉, **facet 카운트만 Start Status 필터를 반영하지 못함** → 개별 카운트가 표시된 전체 레코드(8,470)보다 큼

## 원인 진단 (근거 포함)

1. **RPC 자체는 정상**  
   `defect_items_facets('team','unclosed',false, NULL, [{"column":"start_status","op":"in","value":["Done"]}], 500)` 직접 호출 결과: **MECH 5,028 / ARCH 2,018 / ELEC 1,424 = 합계 8,470** ✓
2. **클라이언트 배선 문제**  
   `MultiSelectDropdown`(`src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx:26-35`)이 `column.getContext().table.options.meta` 에서 `serverFilters`를 읽는데, TanStack Table의 `options.meta`를 통한 간접 전달이 리액트 렌더 사이에 최신값을 보장하지 못하거나, 드롭다운 open 시점의 스냅샷을 사용해 이후 필터 변경이 반영되지 않는 것으로 추정.  
   - `DefectRawDataPage.tsx:632`: `meta: { q, serverFilters }` — 매 렌더 새 객체지만 dropdown 내부의 `useMemo`/`useQuery` 관성에 의해 stale 값이 유지될 수 있음.
   - `columnFilters` 내 `start_status`는 정상적으로 존재(chip 렌더링이 그 증거)하고 `serverFilters` 배열에도 `{column:'start_status', op:'in', value:['Done']}` 형태로 들어감(서버 조회 8,470이 그 증거).

## 수정 방안 (프론트엔드 한정, 로직/데이터 변경 없음)

### 1) `MultiSelectDropdown`에 크로스 필터를 props로 명시 전달

`table.options.meta` 우회를 그만두고 컬럼 정의 단에서 `q`, `serverFilters`를 props로 넘긴다.

- `src/components/defect-management/raw-data/DefectRawDataPage.tsx`
  - `renderHeader`에서 필터 아이콘 렌더 시 `q`와 `serverFilters`를 캡처해 `MultiSelectDropdown`에 직접 전달.
- `src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx`
  - `MultiSelectDropdown` 시그니처를 `{ column, options, q, serverFilters, statusGroup, includeInactive, serverFacetCol }`로 변경.
  - `tableMeta` 경로 제거 → props 값을 그대로 `useDefectFacet`에 넘김.

이렇게 하면 필터/검색어 변경 → 부모 재렌더 → 새 props → React Query가 새 키로 refetch가 결정적으로 이뤄져 stale 카운트 문제가 사라진다.

### 2) 안전장치: query key에 `columnFilters` 원본도 포함(선택)

`useDefectFacet`의 queryKey에 `otherFilters`(현재 사용 중)를 유지하되, `serverFilters` 객체 안정화를 위해 부모의 `useMemo` deps에 `columnFilters` 외 파생값도 포함되어 있는지 재확인. 이미 `useMemo(() => toServerFilters(columnFilters), [columnFilters])`로 정상.

### 3) 회귀 검증

- Snag Raw Data에서 chip `Start Status: Done` 유지 상태로 Team 필터 열기 → MECH 5,028 / ARCH 2,018 / ELEC 1,424 노출, 합계 8,470 확인.
- 여러 컬럼 필터 조합(Team + Building 등) 후 세 번째 컬럼 드롭다운 카운트가 실시간으로 재계산되는지 확인.
- 검색어(`q`) 입력 후 드롭다운 카운트가 반영되는지 확인.

## 영향 범위

- 프론트엔드 2개 파일만 수정 (`DefectRawDataPage.tsx`, `ColumnFilterDropdowns.tsx`).
- DB/RPC/스키마 변경 없음. 다른 모듈(ABD/TM/Spare Part) 영향 없음.
- 사용자 경험은 정확한 크로스 필터 카운트 노출로 개선.

## 대안 (참고)

- meta 경로를 유지하되 `MultiSelectDropdown` 내부에서 `useEffect`로 tableMeta 변경을 감지해 강제 refetch — props 전달보다 복잡하고 stale window가 잠깐 남을 수 있어 비권장.