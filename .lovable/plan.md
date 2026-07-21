## 목표
ABD "Batch No." 파싱·매핑을 추가하고, **대시보드에 Batch No. 필터 + 집계 위젯**을 이번 작업에 포함.

## 1. DB 마이그레이션
1. `abd_items_raw`
   - `ADD COLUMN batch_no text NULL`.
   - `CREATE INDEX abd_items_raw_batch_no_idx ON public.abd_items_raw (team, batch_no) WHERE batch_no IS NOT NULL;`
2. `abd_field_config` 시드
   - `batch_no` : label="Batch No.", group="identity", data_type="text", editable=true, visible=true, sort_order는 `abd_ocs_no` 다음.
3. `abd_header_mappings` 시드
   - MECH/ELEC/ARCH × source_header ∈ {`BATCH NO.`, `BATCH NO`, `BATCH NUMBER`, `BATCH`} → `target_field='batch_no'`, `active=true`.

기존 데이터 백필 없음(NULL 유지, 재임포트로 채움).

## 2. Parser / Server / 컬럼

### `src/lib/abd/parser.ts`
- `ParsedAbdRow`에 `batch_no: string | null` 추가.
- `findHeader()` anchor 라벨에 `BATCH NO.` / `BATCH NO` / `BATCH NUMBER` / `BATCH` 매칭 추가 → `colIndex.batch_no`.
- 행 파싱에 `batch_no: getVal("batch_no") ? String(getVal("batch_no")).trim() : null` 대입.

### `src/lib/abd/mutations.functions.ts`
- `ImportRowSchema`에 `batch_no: z.string().nullable().optional()`.
- upsert payload에 `batch_no: r.batch_no ?? null`.

### `src/lib/abd/columns.ts`
- identity 그룹, `abd_ocs_no` 다음에:
  `{ key: "batch_no", label: "Batch No.", type: "text", width: 110, group: "identity", editable: true, editorType: "text", origin: "identity" }`

Raw Data · Detail Sheet · Column Filter · Export는 `ABD_COLUMNS` 기반이라 자동 반영.

## 3. Raw Data 라우트 검색 파라미터
- `src/routes/_authenticated/closure/abd/raw-data.tsx`의 `abdRawDataSearchSchema`에 `batch: fallback(z.string(), "").default("")` 추가.
- `AbdRawDataPage`에서 기존 컬럼 필터 파이프라인이 `ABD_COLUMNS.filter` 기반으로 batch_no 다중선택을 자동 노출(별도 UI 추가 불필요, 필요 시 원-클릭 링크만 dashboard에서 전달).

## 4. 대시보드 데이터 계층 확장 (`src/lib/abd/dashboard-data.ts`)
- `Row` 타입과 `SELECT_COLS`에 `batch_no` 추가.
- `AbdDashboardData`에 다음 필드 추가:
  - `byBatch: CrossCutCell[]` — batch_no별 total/approved/pending/overdue (batch_no IS NULL 은 `"— No Batch"` 키로 별도 표기).
  - 집계 로직은 기존 `byTeam/byPic/byDis`와 동일 패턴 사용.
- `loadAbdDashboardData({ asOf, batchNo? })` 파라미터 확장: `batchNo`가 주어지면 Supabase 쿼리 단계에서 `eq('batch_no', batchNo)` (또는 `is null` 옵션)로 서버측 필터 적용 후 나머지 KPI/Funnel/Trend/Attention/CrossCut 그대로 재계산.
- 별도 `loadAbdBatchOptions()` 유틸:  batch_no distinct + row count 조회(RPC 없이 `select batch_no, count`), 팀별 필터도 지원. 캐시 5분.

## 5. 대시보드 UI (`AbdDashboardPage.tsx`)
1. **Batch 필터 상단 툴바 추가**  
   - "As of" 옆에 `Batch No.` `Select` (multi-select 대신 단일 선택 우선; option 목록은 `loadAbdBatchOptions`).
   - 선택 시 useQuery key에 `batchNo` 포함 → 전체 대시보드가 해당 batch로 필터링.
   - "All batches" / "No batch (미부여)" / 개별 batch 옵션.
2. **집계 위젯 카드 신설: "Batch Progress"**
   - `CrossCutSection` 옆(또는 아래)에 신규 카드로 배치.
   - `data.byBatch` 를 재사용해 `CrossCutList`와 동일한 스타일로 각 batch별 approved% / overdue 표시.
   - 각 행 클릭 시 `openRawData({ batch: c.key })` — Raw Data 필터로 이동.
   - 상단 batch 필터가 걸린 경우는 카드 자체를 축소(선택된 batch만 표시).

## 6. 라우트 검색 파라미터 연동
- 대시보드 batch 필터 상태를 URL search param `?batch=...` 로 동기화하여 새로고침/공유 시 유지.

## 7. 검증
1. 마이그레이션 후 컬럼/인덱스 존재 확인.
2. Batch No. 헤더 포함 엑셀 임포트 → Raw Data 컬럼/값 노출.
3. Admin > Mapping > As Built Drawing > Header Mapping 3팀 시드 노출.
4. 대시보드 상단 Batch Select 조작 → KPI/Funnel/Trend/Attention 전부 재집계.
5. 신규 "Batch Progress" 카드 행 클릭 → Raw Data가 `batch` 필터로 진입.
6. Batch No.가 없는 승인건은 `"— No Batch"` 그룹으로 정상 노출.

## 8. 오픈 이슈
- Batch 필터를 **단일 선택 vs 다중 선택** 중 어느 쪽으로 할지 확답 필요.  
  → 기본안: **단일 선택**(대시보드 성능·URL 단순화). 다중 선택이 필요하면 알려주세요.
- "Batch Progress" 카드의 정렬 기준 기본값은 **approved% 낮은 순 → total 큰 순**(진척이 뒤처진 batch 우선 노출). 다르게 원하시면 알려주세요.