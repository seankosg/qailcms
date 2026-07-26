# ABD Raw Data — 페이지사이즈에 "ALL" 추가

## 현재 상태 (확인 완료)

- `src/components/abd/raw-data/AbdRawDataPage.tsx`는 URL search param 기반 서버 페이지네이션 사용 (`page`, `pageSize`).
- 데이터/통계/필터/검색은 모두 서버 RPC 3종으로 처리되므로 페이지네이션과 무관하게 **전체 데이터** 기준으로 정확:
  - `abd_items_search(_offset, _limit, _q, _filters, _sort, ...)` — 현재 페이지 rows + `total_count`
  - `abd_items_counts(...)` — Approved / In Progress / Not Started / Excluded / Total 카운트 (전체 대상)
  - `abd_items_facets(_column, _q, _filters, ...)` — 컬럼 필터 드롭다운의 값·카운트 (자기 자신 제외한 크로스 필터 반영, 전체 대상)
- 즉, 페이지를 넘겨도 상단 KPI/탭 카운트, 컬럼 필터 옵션, 검색(`q`), 정렬(`sort`)은 **현재 화면의 100건이 아니라 서버의 전체 매칭 집합**에 대해 계산됨. 화면 렌더링만 페이지 슬라이스.

## 변경 사항

`AbdRawDataPage.tsx` 한 파일만 수정.

1. `PAGE_SIZE_OPTIONS`에 `ALL` 추가 — 배열 형태를 `Array<number | "all">`로 확장 후 `[50, 100, 200, 500, "all"]`로 변경.
2. `pageSize` 파싱 로직 보정:
   - URL 값이 `"all"`이면 특수값 처리.
   - 숫자면 기존 옵션 검증.
3. RPC 호출 파라미터:
   - `ALL` 선택 시 `_offset = 0`, `_limit` = 매우 큰 값 (예: `1_000_000`) 또는 실제 total 이상.
   - 서버 RPC가 `_limit` 없이 호출을 허용하지 않으므로 상한값 방식이 안전.
4. 페이지 컨트롤 표시:
   - ALL 모드에서는 `pageCount = 1`, 페이지 이동 버튼 비활성.
   - 표시 카운트는 `1–{total} / {total}`.
5. `<Select>` 옵션 라벨: 숫자는 그대로, `"all"`은 `ALL`로 표시. 값은 `"all"` 문자열.

## 기술 노트 (개발자용)

- 대량 렌더링 주의: ABD 데이터 규모(수천~수만 건)에서 ALL 선택 시 브라우저 DOM 부담이 커질 수 있음. 현재 테이블은 가상화 없이 렌더링되므로, 사용자가 ALL을 명시적으로 선택했을 때만 활성화되도록 두고 기본값은 100 유지.
- URL 공유성 유지: `pageSize=all`로 URL에 그대로 반영.
- `useAbdItemsQuery`의 파라미터 타입(`pageSize: number`)은 그대로 두고, 컴포넌트에서 `"all" → 큰 숫자`로 변환 후 넘김.

## 검증

- 타입체크 통과.
- 미리보기에서 ALL 선택 → 전체 rows 표시, 카운트/필터/검색 동작 재확인.
