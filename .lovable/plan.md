# SM Raw Data — 필터 결과 전체 선택 (Select All Matching)

페이지네이션은 그대로 유지하고, 현재 필터/검색 조건에 매칭되는 **전체 행 ID를 한 번에 선택** 하여 일괄 편집·삭제·엑스포트에 적용할 수 있게 합니다.

## 목표 UX

- 헤더 체크박스를 클릭하면 지금처럼 **"현재 페이지 N건 선택"**.
- 헤더 체크박스 옆(또는 아래 얇은 배너)에 링크형 액션:
  - 부분 선택 상태: `"필터된 전체 {total}건 선택"`
  - 전체 매칭 선택 상태: `"이 페이지 {pageSize}건만 선택"`
  - 로딩 중: `"불러오는 중…"` (spinner)
- 선택 후 기존 `BulkEditBar`가 그대로 사용되며, `count`, `chunkCount` 표시가 정확히 반영됨.
- 필터/탭/검색어가 바뀌면 "매칭 전체 선택" 상태는 자동 해제.

## 구현 범위

### 1. 서버: 필터 조건 → ID 배열 RPC 추가

새 SQL 함수 `defect_items_search_ids(_status_group, _include_inactive, _q, _filters, _sort, _limit)` 추가.
- 기존 `defect_items_search`와 **동일한 WHERE/필터 로직**을 공유하도록, 공통 조건을 생성하는 내부 로직을 그대로 사용해 `SELECT id ... LIMIT _limit` 만 반환.
- 반환은 `SETOF uuid` (or `TABLE(id uuid)`).
- 안전 상한 `_limit` 기본 100,000. UI에서 그 이상이면 경고.
- `GRANT EXECUTE ... TO authenticated;`

기존 RPC를 그대로 수정하지 않고 새 함수로 분리하는 이유: 페이지 조회는 JSONB row 전체를 만들지만, 이 액션은 id만 필요해 훨씬 가볍기 때문.

### 2. 클라이언트 훅

`src/hooks/useDefectItems.ts`에 `fetchDefectItemIds({ statusGroup, includeInactive, q, filters, limit })` 추가 — `supabase.rpc` 1회 호출로 uuid 배열 반환. `useQuery`가 아닌 명령형 함수로 노출 (버튼 클릭 시에만 실행).

### 3. Raw Data 페이지 상태

`DefectRawDataPage.tsx`에 추가:
- `allMatchIds: string[] | null` — 서버에서 받아온 매칭 전체 ID 목록.
- `fetchingAllMatch: boolean` — 로딩 상태.
- 필터/검색/탭 변경 시 `allMatchIds`를 자동 `null` 리셋 (기존 `useEffect`와 필터 setter들에서).

`selectedRows` 파생 로직 변경:
- `allMatchIds`가 존재하면 → `allMatchIds.map(id => ({ id }))` 를 `BulkEditBar`에 전달 (필드 편집·삭제는 id만 있으면 충분).
- Export "선택 항목만 xlsx" 는 현재 페이지 행만 dataset을 가지고 있어 매칭 전체 선택 시엔 "현재 로드된 페이지 데이터만 포함됨"을 안내 (또는 매칭 전체 선택 시 Export를 비활성화하고 "Export All (필터 반영)" 기존 흐름 사용을 유도).

### 4. 헤더 체크박스 옆 링크

테이블 헤더의 `__select` 컬럼 헤더에 조건부 링크 렌더:
- `total > pageSize && !allMatchIds` && 현재 페이지가 완전 선택된 경우 → `"필터된 전체 {total}건 선택"` 링크 노출.
- `allMatchIds`가 활성이면 → `"이 페이지 {rows.length}건만 선택"` 링크.

### 5. BulkEditBar와의 호환

`BulkEditBar`는 `selectedRows`의 `id`만 이용해 chunk 처리하므로 그대로 동작. 다만:
- Confirm 다이얼로그의 "Before/After" 미리보기는 현재 페이지 데이터가 아닌 ID만 있는 경우 값 미표시(`—`) — 이는 허용 (매칭 전체 선택은 대량 편집 상황이라 미리보기보다 개수 확인이 핵심).
- 상단 카운트 `{count} selected · Will run in {chunkCount} batches of 500` 표시는 그대로 유효.

## 비영향 범위

- `defect_items_search` RPC 시그니처, 인덱스, RLS 정책은 변경하지 않음.
- 페이지네이션 UI/URL 파라미터 (`page`, `pageSize`) 그대로 유지.
- TM/ABD Raw Data는 이번 스코프 아님 (동일 UX가 필요하면 후속 작업).

## 기술 노트

- 신규 RPC는 `SECURITY INVOKER` — RLS를 그대로 상속받아 권한 문제 없음.
- 반환 상한(100k) 초과 시 UI가 `"상한 초과, 필터를 좁혀주세요"` 토스트.
- 클라이언트는 100k UUID(~3.6MB) 정도까진 문자열 배열로 편안히 처리 가능.
- Bulk update/delete 자체는 이미 500개 chunk 반복 로직이 있음.

## 완료 기준 (검증)

1. 필터 걸린 상태에서 헤더 체크박스 → 페이지 100건 선택.
2. `"필터된 전체 N건 선택"` 클릭 → 잠시 후 `N selected` 로 갱신.
3. `BulkEditBar`에서 필드 변경 → 배치 진행률 토스트 후 완료, 새로고침 시 매칭 전체 반영 확인.
4. 필터 변경 시 자동으로 선택 해제되어 `N selected`가 사라짐.
