## 배경
현재 `src/components/resource/dmr/DmrRawDataPage.tsx`는 커스텀 `<table>` + 간단한 툴바 필터로 구현되어 있어, "SM의 Raw Data UI 및 기능과 동일하게 구현" 지시가 부분적으로만 반영된 상태입니다. 아래 스코프로 SM `DefectRawDataPage`의 구조를 그대로 이식합니다.

## 확정 스코프 (사용자 승인)

포함:
- TanStack Table + `useVirtualizer` 가상 스크롤
- 컬럼 리사이즈 / 순서 변경 / 숨김 / 고정(sticky)
- 컬럼 헤더별 필터 드롭다운 (Column Filter)
- Export Excel + URL 상태 동기화 + 페이지네이션 UI + 뷰 프리퍼런스 저장

제외 (DMR 성격상 불필요):
- Stage Progress 가상 컬럼 / 상태 카운트 탭
- Critical / Critical Bulk Bar
- Origin 헤더 스타일 / `defect_field_config` 동적 컬럼 (DMR은 8개 고정 컬럼)

## 구현 계획

### 1. 라우트 search 스키마
`src/routes/_authenticated/resource/dmr/raw-data.tsx`
- `validateSearch`에 `zodValidator` 적용: `q, page, pageSize, sort, filters(JSON), discipline, plot, directOnly, from, to, cols(hidden), colOrder, colSizes, pinned`.
- SM과 동일한 `fallback()` 패턴 사용.

### 2. 컬럼 정의
`src/lib/dmr/columns.ts` (신규)
- 8개 고정 컬럼: `report_date, discipline, system_name, contractor_name, direct_flag(파생), plot, plan_manpower, actual_manpower, diff_manpower`.
- 각 컬럼: `key, label, type('text'|'number'|'date'|'enum'), enumOptions?, align, defaultWidth`.
- SM `DEFECT_COLUMNS` 스타일 유지.

### 3. 서버 필터/정렬 훅
`src/hooks/useDmrItems.ts` (신규)
- `useDmrItemsQuery({ filters, sort, page, pageSize })` — `supabase.from('dmr_entries')` 서버 페이징/정렬.
- `useDmrColumnFacet(field)` — Column Filter 드롭다운용 distinct 목록 (System/Contractor/Discipline/Plot 등). 대량 시 서버 RPC 신규 `dmr_column_facet(field, filters)`로 상위 N개 + 검색.
- 필터 연산자: `in`, `equals`, `range(number/date)`, `contains(text)`, `is_null`.

### 4. 필요한 RPC 마이그레이션
- `dmr_column_facet(field text, filters jsonb) returns table(value text, count bigint)` — SM `defect_items_facets`와 동형.
- 인덱스 점검: `(discipline, report_date)`, `(contractor_name)`, `(system_name)` 등 기존 여부 확인 후 부족한 부분 추가.
- 기존 GRANT/RLS 패턴 유지, `authenticated` 실행 권한 부여.

### 5. 페이지 컴포넌트 재작성
`src/components/resource/dmr/DmrRawDataPage.tsx` (전면 재작성)
- SM `DefectRawDataPage` 구조 복제:
  - `useReactTable` + `useVirtualizer`
  - 서버 정렬/필터/페이지네이션 (URL sync)
  - `ColumnFilterDropdown`을 DMR용으로 파생 (`DmrColumnFilterDropdown` 또는 재사용 여부는 SM 컴포넌트가 defect 전용 훅에 의존하는지 확인 후 결정 — 결합도 높으면 fork).
  - `TopHorizontalScrollbar` 재사용.
  - `ExportDialog` DMR용으로 신규 (`exportDmr.ts`) — 현재 화면의 필터/정렬/컬럼 순서를 반영.
  - Sticky 컬럼: `report_date` 기본 고정, 사용자 pin/unpin 가능. 스티키 배경은 Core 규칙(불투명 + 두겹 오버레이) 준수.
  - `useUserViewPreference('dmr_raw_data')`로 컬럼 순서/폭/숨김/고정/pageSize 저장.
- 기존 상단 툴바는 유지하되 컬럼 필터와 중복되는 System/Contractor는 헤더 드롭다운으로 이관, 상단에는 검색·기간·유형(직영/협력사) 토글만 남김.
- BulkEditBar 및 필터 전체 선택 로직은 그대로 유지.

### 6. Export
`src/components/resource/dmr/ExportDmrDialog.tsx` + `exportDmr.ts`
- 현재 필터/정렬을 서버에서 재조회하여 전체 결과 export (SM `exportAllUnclosed` 패턴).
- 컬럼 순서/숨김 반영, `xlsx` 스킬 준수(zero formula error, header bold).

### 7. 정리 및 검증
- 기존 `DmrBulkEditBar`, `fetchDmrFilteredIds`는 새로운 필터 형식(JSON)에 맞춰 시그니처 조정.
- `tsgo` 타입 체크 통과.
- Playwright로 대량 데이터에서 스크롤/필터/정렬/Export 스모크 테스트.

## 파일 변경 요약
- 신규: `src/lib/dmr/columns.ts`, `src/hooks/useDmrItems.ts`, `src/components/resource/dmr/DmrColumnFilterDropdown.tsx`, `src/components/resource/dmr/ExportDmrDialog.tsx`, `src/components/resource/dmr/exportDmr.ts`, RPC 마이그레이션(`dmr_column_facet`).
- 수정: `src/routes/_authenticated/resource/dmr/raw-data.tsx`, `src/components/resource/dmr/DmrRawDataPage.tsx`, `src/lib/dmr-mutations.functions.ts`, `src/components/resource/dmr/DmrBulkEditBar.tsx` (필터 시그니처 변경분).

## 기술 세부
- SM의 `ColumnFilterDropdown`은 `useDefectFieldConfig` 등 SM 전용 훅에 강결합되어 있어 그대로 재사용은 어렵고, 동일 UI/로직을 DMR용으로 파생하는 편이 안전.
- URL sort 포맷: `field:asc,field2:desc` (SM과 동일).
- URL filters 포맷: JSON stringified `{ field: { op, value } }` (SM과 동일).
- 페이지 사이즈 옵션: `50 / 100 / 200 / 500 / All` (SM과 동일, All은 100만 상한).
