
# Defect Raw Data 로딩 개선 (A + B 안)

## 목표
Defect Raw Data 페이지 진입/필터 변경 시마다 발생하는 전량 재로딩을 제거해 체감 로딩 시간을 대폭 단축한다. 서버 왕복은 첫 진입과 명시적 “Refresh” 시에만 발생시키고, teams/status/검색어 필터는 클라이언트에서 즉시 반영한다.

## 변경 내용

### 1) `src/hooks/useDefectRawData.ts`
- `DefectFilters` 는 유지하되, **서버 쿼리에서는 `includeInactive` 만 반영**. teams / status / q 는 서버 쿼리에서 제거.
- 쿼리 키를 `["defect-raw-data", { includeInactive }]` 로 단순화 → 필터 변경 시 캐시 재사용.
- React Query 옵션:
  - `staleTime: 5 * 60_000` (5분)
  - `gcTime: 30 * 60_000` (30분)
  - `refetchOnWindowFocus: false`
  - `refetchOnMount: false` (캐시 있으면 재요청 안 함, stale 이어도 백그라운드 refetch만)
- 기존 `getDefectLatestDataDate` 로직 유지.

### 2) `src/components/defect-management/raw-data/DefectRawDataPage.tsx`
- `useDefectRawData` 는 `{ includeInactive }` 만 넘기고, teams/status/q 필터링은 `useMemo` 로 클라이언트에서 수행:
  - teams: `filters.teams.length === 0 || filters.teams.includes(row.team)`
  - status: `filters.status.length === 0 || filters.status.includes(row.status_raw ?? "")`
  - q: 기존 서버 `or(ilike)` 대상 컬럼 6종(`source_issue_no`, `description`, `location_raw`, `assigned_to`, `subcontractor_name`, `hdec_pic_name`)에 대해 대소문자 무시 `includes` 매칭.
- 필터 적용된 배열을 기존에 테이블에 넘기던 데이터 자리에 그대로 대입 (하위 로직 변경 없음).
- 상단 툴바에 **Refresh 버튼**(이미 import 된 `RefreshCcw` 아이콘 사용) 추가 → `queryClient.invalidateQueries({ queryKey: ["defect-raw-data"] })` + `refetch()`.

## 비변경 항목
- `defect_items_raw` 스키마, 컬럼 선택(`select("*")`), 정렬, 페이지 크기, 40k 안전상한 유지.
- 상세/편집/BulkEdit/Export 등 다른 흐름 변경 없음.
- localStorage 컬럼 프리퍼런스 등 다른 저장 로직 변경 없음.

## 파일 변경 목록
- 수정: `src/hooks/useDefectRawData.ts`
- 수정: `src/components/defect-management/raw-data/DefectRawDataPage.tsx`

## 검증
- 진입 → 30초 이상 대기 후 다른 페이지 갔다 복귀 시 재요청이 발생하지 않는지 확인.
- teams/status/검색어 변경 시 네트워크 요청 없이 즉시 필터링되는지 확인.
- Refresh 버튼 클릭 시에만 서버 재조회되는지 확인.
- 첫 로드 결과 `latestDataDate` 표시 정상 여부 확인.
