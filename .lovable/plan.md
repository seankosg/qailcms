# 전 Raw Data 컬럼 필터 통일 계획

## 목표
- 4개 Raw Data 페이지(ABD, Snag/Defect, Spare Part, Task Management)의 **모든 표시 컬럼**에 필터 아이콘/드롭다운을 노출한다.
- 텍스트 형식 컬럼(예: `description`, `remarks`, `document_title`, `pic`, `location_raw`, `item` 등)의 필터를 **현재 Snag의 `Item` 컬럼 필터와 동일한 UX** — 컬럼에 실제 존재하는 값들의 체크박스 리스트에서 다중 선택 — 으로 바꾼다.
- 날짜 컬럼은 기존 date-range 필터, 숫자/퍼센트 컬럼은 기존 number/text 필터를 유지한다. (요청 대상은 "텍스트 양식의 컬럼")

## 범위 (대상 파일)

| 페이지 | 라우트 | 컬럼/필터 파일 |
| --- | --- | --- |
| ABD | `/closure/abd/raw-data` | `src/components/abd/raw-data/AbdRawDataPage.tsx`, `AbdColumnFilterDropdowns.tsx`, `src/lib/abd/filter-fns.ts`, `useAbdItems.ts`(facet) |
| Snag(Defect) | `/closure/snag-management/raw-data` | `DefectRawDataPage.tsx`, `ColumnFilterDropdowns.tsx`, `src/lib/defect-management/filter-fns.ts`, `useDefectItems.ts`(facet) |
| Spare Part | `/closure/spare-part/raw-data` | `SparePartRawDataPage.tsx`, `ColumnFilters.tsx`, `src/lib/spare-part/filters.ts` |
| Task Management | `/closure/task-management/raw-data` | `TaskManagementRawDataPage.tsx`, `ColumnFilters.tsx`, `src/lib/task-management/filters.ts` |

## 통일 규칙

각 페이지의 `filterType` 판정 로직을 아래로 통일한다.

```text
date  형식 → "date-range"        (기존 유지)
숫자/퍼센트 → "number-range" 또는 "text" (기존 유지)
bool  형식 → 기존 boolean/multi-select 유지
그 외(문자열/enum 전부) → "multi-select"  ← 텍스트도 여기로 이동
```

즉 지금까지 `TEXT_FILTER_FIELDS`에 있던 컬럼(ABD의 `abd_number`, `abd_ocs_no`, `document_title`, `pic`, `service`, Snag의 `description`, `remarks`, `hdec_comments`, `aconex_comments`, `location_raw`, `item`, `plan_title`, `assigned_to` 등)을 모두 multi-select로 옮긴다. `TEXT_FILTER_FIELDS` 집합은 제거하거나 빈 값으로 축소한다.

또한 현재 `enableColumnFilter`가 꺼져 있거나 헤더에 필터 드롭다운이 렌더되지 않는 컬럼(대표적으로 `sl_no`, stage-progress 파생 컬럼 등)이 있다면, 값이 있는 컬럼은 모두 필터 아이콘을 노출한다. 파생/계산 컬럼 중 서버 필터가 불가능한 것은 기존대로 유지하되(예: `derived`) 사용자에게 필터 미지원이 아니라 값 리스트를 보여주도록 client-side facet(현재 페이지 rows 기준)을 fallback으로 사용한다.

## 텍스트 컬럼 multi-select 상세 (Snag Item 스타일 확장)

기존 `MultiSelectDropdown`(Snag) / `AbdMultiSelectDropdown`(ABD) 은 팝오버 안에 체크박스 목록만 있다. 텍스트 컬럼은 distinct 값 수가 수백~수천 개가 될 수 있으므로 다음 두 가지를 추가한다.

1. **팝오버 상단 검색 입력**: 표시된 값들을 클라이언트에서 substring 필터링. 이미 `Select all` / `Clear all` 이 있는 줄에 `Input` 하나 추가.
2. **facet 로딩 상한 확장**: 서버 facet 훅(`useDefectFacet`, `useAbdFacet`)의 반환 상한(현재 top-N)을 텍스트 컬럼일 때 더 큰 값(예: 500 → 2000) 또는 검색어 서버 필터 파라미터를 추가한다. 우선 단순히 상한만 늘리는 방향으로 시작하고, 실제로 응답 크기가 부담되면 후속으로 서버 side search 파라미터를 추가한다.

Spare Part / Task Management 페이지는 서버 facet이 없고 클라이언트에 rows 전체가 있으므로, 현재 로드된 `rows`에서 distinct 값을 계산해 옵션으로 넘긴다(`uniqueOptions` 유틸을 재사용/신설).

`(Empty)` 옵션과 카운트 표시, 다중 선택, 선택 시 URL 필터 파라미터 인코딩은 기존 multi-select 경로를 그대로 재사용한다 — 각 페이지의 필터 직렬화 로직은 이미 multi-select 배열을 지원한다.

## 서버 필터/정렬 처리 (ABD, Snag)

두 페이지는 서버 필터링/정렬을 사용한다. 텍스트 컬럼이 multi-select로 넘어가면 서버 쿼리도 값 배열 IN 매칭으로 바뀌어야 한다. 각 페이지의 서버 필터 빌더(예: `useAbdItems`, `useDefectItems` 안의 필터 → Supabase 쿼리 변환부)에서:

- 필터 값이 문자열 → `ilike '%text%'` 로 처리하던 분기를 제거하거나 유지하되,
- 배열이 오면 `in(values)` + `EMPTY_TOKEN` 포함 시 `or(is null, eq '')` 를 추가.

이미 multi-select 컬럼에 사용하던 로직을 그대로 재활용한다.

## 검증 항목

- 각 페이지의 모든 컬럼 헤더에 필터 아이콘이 표시된다.
- 텍스트 컬럼 필터 클릭 시, 현재 데이터셋에 존재하는 값 리스트 + `(Empty)` 옵션 + 검색 입력이 나타난다.
- 여러 값 체크 → 테이블은 선택한 값 중 하나에 해당하는 행만 표시.
- URL 파라미터(`filters=`)에 다중값이 저장·복원된다.
- 날짜/숫자 컬럼 필터 UX는 변경되지 않는다.
- Sticky 컬럼 불투명 규칙, 기존 정렬/페이지네이션은 회귀 없음.

## 비변경
- 데이터베이스 스키마, 마이그레이션 없음.
- 컬럼 표시 순서/pin/visibility 관련 저장 로직 변경 없음.
- 상세 Sheet, Export 다이얼로그 변경 없음.
