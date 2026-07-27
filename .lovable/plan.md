## 원인 (확정)
- DB에서 `abd_items_search('MECH,ELEC,ARCH', ..., _limit=1000000)` 직접 호출 → **6,715행 반환**.
- 클라이언트에서 같은 RPC 호출 → **정확히 1,000행에서 잘림**.
- 원인: Supabase Data API(PostgREST) 응답 상한이 1,000행. `_limit` 값과 무관하게 게이트웨이가 상단에서 자름. Lovable Cloud에서는 설정으로 상한을 늘릴 수 없음.
- 결과: ALL 페이지도 실제로는 1,000행만 로드되고 있었고 Export는 그 1,000행만 파일로 씀.

## 계획 A — 청크 루프 페칭 하나만 도입 (최소 변경)

### 변경 파일: `src/hooks/useAbdItems.ts`
`useAbdItemsQuery`의 queryFn 만 수정:

1. `CHUNK = 1000` 상수 정의.
2. `p.pageSize <= CHUNK` → 지금과 동일하게 단일 호출(성능 영향 없음).
3. `p.pageSize > CHUNK` (실질적으로 ALL만 해당) → 다음 로직 수행:
   - `_offset = p.page 기반 offset` (ALL은 0), `_limit = CHUNK` 로 첫 배치 호출.
   - 첫 배치 응답에서 `total_count` 확보.
   - `while (fetched < min(total_count, p.pageSize))` 반복해 `_offset += CHUNK` 로 후속 배치 호출, 계약 검증(현재의 `rows` 객체 여부 체크)은 배치마다 유지.
   - 모든 배치의 `rows`를 합쳐 `{ rows, total: total_count }` 반환.
4. 안전 상한: 최대 반복 회수 = `Math.ceil(pageSize / CHUNK)` (ALL=1,000,000 → 최대 1,000회지만 total_count에서 조기 종료). 무한루프 방지 가드로 `fetched`가 진행되지 않으면 즉시 throw.
5. 계약 위반 시 throw 는 현재 로직 그대로 유지 (`shape mismatch` 에러).

`AbdItemsQueryParams`, 반환 타입(`{ rows, total }`), queryKey 구조는 **변경 없음** → 호출부(`AbdRawDataPage`, Export Dialog) 코드 수정 불필요.

### 부수적으로 하지 않을 것
- Export Dialog UI/포맷 개편, 스코프 라디오 (다음 요청 시)
- Facet/Counts RPC 는 그대로 (집계 단일 행 반환이라 상한 무관)
- `defect_items_search`/`spare_parts` 등 타 모듈 (이번 스코프 아님, 필요 시 별도 요청)
- DB 함수 수정 (반환 shape 원복 상태 유지)

### 검증 절차
1. `/closure/abd/raw-data?tab=MECH,ELEC&plot=all&pageSize=all`
   - 헤더 카운트 `6,715 / 6,715` 표시.
   - 테이블 실제 렌더 행 수 6,715.
2. 같은 화면에서 Export 실행 → 엑셀 데이터 행 6,715.
3. `pageSize=100` 기본 페이지에서 단일 호출로 100행 로드, 네트워크 탭에 `abd_items_search` 호출 1회 확인 (회귀 없음).
4. 필터 1~2개 적용 후 ALL 재조회 → 상단 카운트와 렌더 행 수 일치 확인.
