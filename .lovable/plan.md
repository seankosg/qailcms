## 목표
DMR Raw Data 페이지를 SM Raw Data UI 관례에 맞춰 정렬·다중 필터·행 선택·Mass 수정/삭제 기능을 갖추도록 확장한다. 다만 DMR은 컬럼 8개, 값이 대부분 enum이므로 SM의 컬럼 매니저·뷰 프리셋·크리티컬 바 등 과잉 요소는 포함하지 않는다.

## UI 구성 (SM Raw Data 참조)

### 1. 필터 툴바 (상단, 카드 안)
- 기존 필터 유지: 공종·Plot·Metric·From·To·자유텍스트 검색
- **`System` 다중선택 값 리스트 필터** 추가: 현재 데이터에 존재하는 `system_name` 유니크 값을 팝오버 체크리스트로 노출 (SM 텍스트 컬럼 필터와 동일 방식)
- **`Contractor` 다중선택 값 리스트 필터** 추가: 마찬가지로 유니크 값 체크리스트, `is_direct` 뱃지 함께 표시
- **`직영/협력사` 토글 그룹** 추가 (`ToggleGroup type="multiple"`, 두 값 다중선택 가능, 미선택=전체)
- 우측 요약: 로드된 행수·전체 카운트·총 인원 합계
- "필터 초기화" 버튼 (선택된 필터가 하나라도 있을 때만 노출)

### 2. 테이블 헤더 정렬
- 각 컬럼 헤더 클릭 시 asc → desc → 해제 3-state 토글, 아이콘 표시(`ArrowUpDown`/`ArrowUp`/`ArrowDown`)
- 정렬 가능 컬럼: `report_date`, `discipline`, `system_name`, `contractor_name`, `plot`, `metric`, `manpower`
- 정렬은 클라이언트 측(현재 로드된 행 대상)이 아닌 **서버 정렬**로 처리 — Supabase `.order(field, { ascending })` 사용, 페이지 제한(현재 200)이므로 서버 정렬이 정합성 유지에 필수
- 기본 정렬: `report_date DESC, discipline, system_name, contractor_name` (현재 동작 유지)

### 3. 행 선택 + Mass 편집 바
- 좌측 체크박스 컬럼(고정) 추가
  - 헤더 체크박스: 현재 페이지 전체 선택/해제
  - "필터된 전체 선택" 링크: 총 카운트가 페이지 크기보다 클 때 노출 → 필터 조건에 매칭되는 모든 id를 서버에서 가져와 선택 (SM 관례)
- 선택된 행이 1건 이상이면 하단 스티키 `BulkEditBar` 표시 (SM `BulkEditBar` 스타일 준수)
  - **필드 선택**: `report_date`(date) / `discipline`(select) / `system_name`(text) / `contractor_name`(text) / `plot`(select) / `metric`(select) / `manpower`(number)
  - **값 입력**: 필드 타입에 맞춘 위젯 (date input, select, text input, number input)
  - **"빈 값으로 설정" 체크박스**: SM과 동일 — 단, DMR 스키마상 모든 필드가 NOT NULL이므로 이 옵션은 비활성화 (`disabled`) 처리
  - **적용** 버튼 → 확인 다이얼로그 → 500건 단위 청크 업데이트
  - **삭제 드롭다운 메뉴**: "선택 항목 삭제" → 확인 다이얼로그(`DELETE` 텍스트 입력) → 500건 단위 청크 삭제
  - **엑셀 내보내기** / **TSV 복사**: SM `bulk-actions` 참고하여 DMR 8개 컬럼용 `exportColumns` 정의
  - **X 버튼**: 선택 해제
- 권한: `canEdit`(admin/superuser/d_superuser/senior_user) 이 아니면 편집·삭제 버튼 비활성화 + 툴팁 "권한 없음", 엑셀/TSV는 누구나 가능

### 4. Mass 수정 시 검증
- `discipline`/`plot`/`metric`은 CHECK 제약이 있으므로 select 옵션에 스키마 상수만 노출
- `manpower`는 음수 방지(0 이상만 허용)
- `system_name`/`contractor_name` 값 변경 시 마스터 테이블 자동 upsert (기존 `dmr-import.functions.ts`의 마스터 등록 로직 재활용)
- UNIQUE 제약 `(report_date, discipline, system_name, contractor_name, plot, metric)` 위반 가능성 → 청크별 결과에서 실패 건수를 토스트로 집계 보고

## 신규/수정 파일

### 신규
- `src/components/resource/dmr/DmrBulkEditBar.tsx` — SM `BulkEditBar`를 DMR 필드에 맞춰 축약 이식 (탭·필드 그룹 없이 단일 필드 리스트)
- `src/lib/dmr-mutations.functions.ts` — `bulkUpdateDmrEntries({ ids, patch })`, `bulkDeleteDmrEntries({ ids })` 서버 함수 (`requireSupabaseAuth` + 청크 처리 + system/contractor 마스터 upsert)
- `src/lib/dmr/bulk-actions.ts` — TSV 복사, XLSX 내보내기 유틸 (SM `bulk-actions` 축약본)

### 수정
- `src/components/resource/dmr/DmrRawDataPage.tsx`
  - 정렬 상태(`orderBy: {field, asc}`) + URL 반영 옵션 없이 로컬 상태로 우선 관리
  - 필터 상태에 `systems: string[]`, `contractors: string[]`, `directOnly: ('direct'|'sub')[]` 추가
  - 페이지 크기 200 유지, 총 카운트 표시
  - `useQuery` — `.in()` / `.order()` 동적 적용
  - 행 선택 상태(`Record<id, boolean>`), 헤더 체크박스, "필터된 전체 선택" 액션
  - 유니크 값 옵션은 별도 `useQuery`로 `dmr_entries`에서 `system_name`, `contractor_name` DISTINCT 조회 (RPC 없이 `.select('field').limit(2000)` 후 클라이언트 dedupe — DMR은 규모가 작으므로 충분)

## 스코프 제외
- 컬럼 순서 재배치·표시 여부·프리셋 저장 (SM 뷰 프리셋 시스템은 DMR 규모상 과잉)
- 셀 인라인 편집 (Mass 수정 바로 대체)
- URL 쿼리 반영 (다음 단계에서 필요 시 확장)
- 무한 스크롤/커서 페이지네이션 (현재 페이지 크기 200 유지, 필요 시 별도 개선)

## 검증
- tsgo 타입 체크 통과
- 대량 100건 이상 선택 시 500건 청크 로직 확인 (사용자가 대용량 케이스 없더라도 동일 로직 사용)
- Mass 수정 후 dashboard/raw-data 캐시 무효화 (`queryClient.invalidateQueries`)
- UNIQUE 제약 위반 케이스 토스트 문구 확인
