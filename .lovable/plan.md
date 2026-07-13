
# Defect Raw Data — 서버 페이지네이션 전환 + Unclosed/Closed 탭 분리 (총 25만행 기준)

전제 명확화: **Closed + Unclosed 합산 최대 약 25만행**. 이미 10만행을 넘겼고, 성장 여지를 고려해도 최대 25만 규모.

이 규모에서도 클라이언트 전량 fetch(`useDefectRawData`)는 이미 한계에 도달했고(`DataCloneError: out of memory` 재현됨), Closed까지 포함해 조회할수록 악화됩니다. 따라서 **탭 분리 + 서버 사이드 필터/정렬/페이지네이션**을 이번 스프린트의 기본 아키텍처로 확정합니다. 물리적 데이터 이동은 하지 않고 `status_group` 파생 컬럼으로 논리 분리합니다.

---

## 1. 아키텍처 결정 (확정)

- 리스트 조회는 **서버 사이드 필터/정렬/페이지네이션**으로 일원화.
- **Unclosed 탭**(Open/Reopen 등) / **Closed 탭**(Closed 전용) 2탭 구조. 같은 페이지 내 전환. 사이드메뉴는 그대로.
- 임포트 시 Closed로 바뀐 행은 물리 이동 없이 `status_group` 재계산으로 자동 이관.
- 대시보드/집계는 전량 클라이언트 스캔이 아닌 서버 집계 RPC로 처리.

---

## 2. DB 마이그레이션 (필수)

### 2-A. `status_group` generated column
```sql
alter table public.defect_items_raw
  add column status_group text generated always as (
    case when lower(trim(status_raw))='closed' then 'closed' else 'unclosed' end
  ) stored;
```

### 2-B. 인덱스 세트 (25만 규모 대응)
- `(is_active, status_group, source_issue_no desc)` — Unclosed 기본 정렬.
- `(is_active, status_group, actual_closure_date desc)` — Closed 기본 정렬.
- `(is_active, status_group, team)`, `(is_active, status_group, subcontractor_name)`, `(is_active, status_group, area_level)` — 흔한 필터.
- `pg_trgm` GIN: `description`, `source_issue_no`, `location_raw`, `area_location`, `subcontractor_name`, `hdec_pic_name` (글로벌 검색용, 초기엔 컬럼별 개별 trgm 인덱스로 시작).

### 2-C. 서버 검색 RPC `defect_items_search`
- 인자: `_status_group('unclosed'|'closed'|'all')`, `_include_inactive bool`, `_q text`, `_filters jsonb`, `_sort jsonb`, `_offset int`, `_limit int`.
- 반환: `rows jsonb`(리스트에 필요한 ~25컬럼만), `total_count bigint`(`count(*) over ()`).
- Dynamic SQL은 화이트리스트(`DEFECT_COLUMNS.key`) 기반으로 컬럼명 검증. `security invoker` + RLS 유지.

### 2-D. Facets RPC `defect_items_facets`
- 인자: `_status_group`, `_include_inactive`, `_column`(화이트리스트).
- 컬럼별 distinct 값 + 카운트. React Query 짧은 staleTime(60s)로 캐시.

### 2-E. 카운트 RPC `defect_items_counts`
- Unclosed / Closed 카운트 반환. 탭 배지 전용.

### 2-F. 대시보드 집계 RPC `defect_items_dashboard_summary`
- `CriticalPendingBar`, `latestDataDate` 등에 필요한 값만 서버에서 집계.

---

## 3. 클라이언트 변경

### 3-A. 폐기
- `useDefectRawData`(전량 fetch 훅).
- 클라이언트 전체 정렬/필터/faceted uniqueOptions 계산.
- 클라이언트 latestDataDate/critical pending 전량 스캔.
- 40k `SAFETY_CAP`, persist cache 계열 코드.

### 3-B. 신설 훅
- `useDefectItemsQuery({ statusGroup, page, pageSize, sort, filters, q, includeInactive })` → `defect_items_search`. 반환 `{ rows, total }`.
- `useDefectFacet(column, { statusGroup })` → `defect_items_facets`.
- `useDefectStatusCounts({ includeInactive })` → `defect_items_counts`.
- `useDefectDashboardSummary()` → summary RPC.

### 3-C. URL 상태 (TanStack Router `validateSearch` + `fallback`)
- `tab: "unclosed" | "closed"` (기본 `unclosed`)
- `page: number` (기본 1), `pageSize: number` (기본 100)
- `sort: string`, `q: string`, `filters: string`(압축 JSON), `includeInactive: boolean`
- 새로고침/공유/뒤로가기 시 상태 보존.

### 3-D. 페이지네이션 UX
- 기본: **명시 페이지네이션** (페이지 이동 + pageSize 50/100/200/500 선택). 예측 가능·렌더 안정.
- 페이지 내 최대 500행 범위에서 기존 가상 스크롤 유지.
- 무한 스크롤은 초기 도입 제외(정렬 자유도와 keyset 요건 때문).

### 3-E. UI 변경
- 상단 `<Tabs>`: `Unclosed (n)` / `Closed (n)`. 배지는 `useDefectStatusCounts`.
- **Unclosed 탭**: 현행 기본, 정렬 `source_issue_no desc`. `CriticalPendingBar` 등 상단 위젯 표시.
- **Closed 탭**: `status_raw` 숨김, `actual_closure_date` / `hdec_verification` / `hdec_reason` 노출. 정렬 `actual_closure_date desc`. Bulk edit은 기본 비활성(관리자 옵션).
- View preference 키 탭별 분리:
  - `defect-management.raw-data.unclosed.v1`
  - `defect-management.raw-data.closed.v1`
  - 저장: `order`, `visibility`, `frozenExtras`, `columnSizing`, `pageSize`, `sort`. (필터/글로벌 검색은 URL만.)

### 3-F. Export / Bulk edit 재설계
- Export: 서버 라우트 `POST /api/private/defects/export`에서 현재 필터 결과를 CSV/XLSX 스트리밍. 25만 규모 XLSX는 무거우니 CSV 우선.
- Bulk edit: 클라이언트는 `{ filters, selectedIds | selectAllMatching }`만 전송. 서버 RPC가 트랜잭션 처리 + 히스토리 기록.

### 3-G. 임포트 후 캐시 무효화
- 임포트 성공 콜백에서 `queryClient.invalidateQueries({ queryKey: ["defect"] })`.
- `status_raw` 갱신만으로 `status_group` 자동 재계산 → 다음 조회에서 자동으로 해당 탭으로 이동.

---

## 4. “Closed로 변경 시 이동” 정책

논리 이동만 사용(물리 이동 없음).

- 장점: 히스토리(`defect_status_history`)·rollback·상세 링크 그대로. 임포트 로직 최소 변경. Reopen도 대칭 처리.
- 단점/완화: 열린 캐시 잔상 → 임포트 후 invalidate 필수. 편집 중 status 변경 충돌 → mutation 응답의 최신 status로 감지·토스트. 카운트 배지 정합성 → staleTime 30s + 임포트 후 강제 refetch.

---

## 5. 예상 성능 (25만행, 인덱스 적용 후)

- 리스트 100행 페이지 fetch: 50~200ms.
- Unclosed/Closed 카운트: 10~50ms.
- Facets(단일 컬럼): 100~500ms, 캐시 후 즉시.
- 브라우저 메모리: 수백 MB → 수십 MB 이하. `DataCloneError: out of memory` 해소.

---

## 6. 마이그레이션 순서

1. DB 마이그레이션(2-A ~ 2-F).
2. RPC 단위 테스트.
3. 서버 훅 3~4종 도입, 기존 `useDefectRawData`와 병존.
4. `DefectRawDataPage`를 새 훅으로 교체 + 탭·URL·페이지네이션 UI.
5. Export/Bulk edit 서버 경로 전환.
6. `CriticalPendingBar` 등 위젯을 summary RPC로 교체.
7. `useDefectRawData` 및 잔재 제거.
8. 임포트 성공 콜백에서 invalidate 훅업.

각 단계마다 build 통과 확인. 3~4단계는 feature flag로 즉시 롤백 가능하게 유지.

---

## 7. 변경 파일 (요약)

- 마이그레이션 (RPC + 인덱스 + generated column)
- 신규
  - `src/hooks/useDefectItemsQuery.ts`
  - `src/hooks/useDefectFacet.ts`
  - `src/hooks/useDefectStatusCounts.ts`
  - `src/hooks/useDefectDashboardSummary.ts`
  - `src/lib/defect-management/server-filters.ts` (URL search 직렬화/역직렬화)
  - `src/routes/api/private/defects/export.ts` (server route)
- 수정
  - `src/routes/_authenticated/closure/defect-management/raw-data.tsx` (`validateSearch`)
  - `src/components/defect-management/raw-data/DefectRawDataPage.tsx` (탭, URL, 서버 훅)
  - `src/components/defect-management/raw-data/ColumnFilterDropdowns.tsx` (facets RPC)
  - `src/components/defect-management/raw-data/CriticalPendingBar.tsx` (summary RPC)
  - `src/components/defect-management/raw-data/ExportDialog.tsx` (서버 스트림)
  - `src/components/defect-management/raw-data/BulkEditBar.tsx` (서버 mutation)
  - `src/lib/defect-management/derived.ts` (status 정규화 상수)
  - 임포트 콜백 파일(invalidate)
- 제거
  - `src/hooks/useDefectRawData.ts` 및 관련 전량 스캔 유틸

---

## 8. 결정 필요 항목

1. **RPC 4종 승인**: `defect_items_search`, `defect_items_facets`, `defect_items_counts`, `defect_items_dashboard_summary`.
2. **인덱스 세트 승인**(2-B). `pg_trgm` 확장 활성 필요.
3. **Closed 탭 편집 정책**: 완전 읽기전용 / 관리자만 편집 / 모두 편집.
4. **Reopen 표기 정규화 목록**: `Reopen`, `Re-Open`, `Reopened` 외 변형 여부.
5. **Export 포맷 우선순위**: 25만행 XLSX는 무거우니 CSV 우선 권장.
6. **기본 pageSize**: 100 권장(50/100/200/500 선택).

승인 주시면 마이그레이션 → RPC → 훅 → UI 순으로 build 모드에서 즉시 착수합니다.
