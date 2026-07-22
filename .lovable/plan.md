## 목적
SM Raw Data 컬럼 헤더의 멀티-셀렉트 드롭다운에서 각 값 옆에 표시되는 count가 **현재 활성화된 다른 필터/검색 조건**을 반영하도록 크로스-필터링(Excel AutoFilter 방식)으로 개선.

현재는 `defect_items_facets(_column, _status_group, _include_inactive)`만 호출하므로, 다른 컬럼 필터·전역 검색어·탭 조건과 무관하게 전체 도메인 count가 그대로 표시됨.

## 변경 범위 (SM 한정)
ABD/TM/DMR/SP는 이번 요청 범위 밖 → 손대지 않음.

## 1) DB: `defect_items_facets` 시그니처 확장
새 마이그레이션으로 함수 재생성:

```
defect_items_facets(
  _column           text,
  _status_group     text default 'unclosed',
  _include_inactive boolean default false,
  _q                text default null,
  _filters          jsonb default '[]'::jsonb  -- 자기 자신 컬럼 제외한 활성 필터
)
```

- 반환은 그대로 `value text, cnt bigint`.
- 내부 WHERE 구성은 `defect_items_search`의 필터 해석 블록과 **동일한 로직**(text/multi-select/date-range/emptyOnly, `start_status` 파생식 포함)을 재사용해 정합성 확보.
- `_filters`에서 `column === _column`인 항목은 함수 내에서도 방어적으로 제거(자기 자신 제외 → self-count는 다른 값과 동일 기준).
- 기본값이 있으므로 기존 호출부와 호환.

## 2) 훅: `useDefectFacet` 파라미터 확장
`src/hooks/useDefectItems.ts`
- `useDefectFacet(column, { statusGroup, includeInactive, q?, filters?, enabled? })`
- RPC 호출 시 `_q`, `_filters` 전달
- `queryKey`에 `q`와 `filters` 포함(문자열 stable serialize)

## 3) UI: `MultiSelectDropdown`에 현재 필터 주입
`src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx`
- `column.getContext().table` 에서 `getState().columnFilters` 와 `getState().globalFilter` 읽기
- columnFilters → 서버 filter 스펙으로 변환 (**Raw Data 페이지의 기존 client→server 변환 유틸을 재사용**; 없으면 페이지의 로컬 변환 함수를 공용 util로 승격)
- 자기 자신 컬럼(`serverFacetCol`)은 제외
- `useDefectFacet`에 `q`, `filters` 전달
- Popover가 열려있을 때만 활성화(현재 동작 유지) — 다른 필터가 바뀌면 다음 오픈 시 새로 조회

## 4) 동작 규약
- **자기 자신 필터는 제외**: A 컬럼 드롭다운을 열 때, A에 선택된 값들이 있어도 A의 다른 값 count는 "A 선택 무시 + 나머지 필터 반영" 기준(Excel 방식). → 사용자가 A 안에서 다른 값을 추가/교체 판단 가능.
- Status 탭(Unclosed/Closed), Include inactive, 전역 검색어, 나머지 컬럼 필터 → 모두 반영.
- 선택된 값이 반영 결과 count 0이 되더라도 목록에서 사라지지 않고 count 0으로 표시(기존 로직 유지).

## 5) 검증
- ELEC 팀 필터 선택 → Plot 드롭다운 count 합이 ELEC 총합과 일치
- Rectified Status = Rectified 선택 → Start Status 드롭다운 Done/Not finish yet 등 count가 재계산
- 검색어 입력 상태에서 임의 컬럼 드롭다운 오픈 시 count가 검색 결과와 정합
- 기존 정렬/(Empty)/Select all/Clear 동작 유지

## 파일 변경 요약
- (신규 마이그레이션) `defect_items_facets` 재정의
- `src/hooks/useDefectItems.ts` — 파라미터·queryKey 확장
- `src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx` — 현재 필터/검색 주입
- 필요 시 필터 변환 유틸을 페이지에서 `src/lib/defect-management/`로 승격
