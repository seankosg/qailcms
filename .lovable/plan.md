## 목표
Aconex Export의 `Status` + `Review Status` 조합을 정규화하고, 그 결과에 따라 `Date Modified`를 ABD의 올바른 라운드/스테이지 날짜 필드로 라우팅. 현재 라운드는 `Latest Status`(Aconex `Status` 반영값) 기준으로 판별. Excluded 항목은 통계에서 완전히 제외하고 개수만 별도 표시.

## 매핑 규칙 (확정)

| Status | Review Status | semantic | Date Modified 반영 |
|---|---|---|---|
| A - Approved | Approved | DAR_APPROVED | 현재 라운드 `rN_dar_actual` + `rN_response_result='A'` + `approval_date`, `latest_status='A'` |
| B - Approved with Comments | Approved with Comments | DAR_APPROVED | 위와 동일하되 `rN_response_result='B'`, `latest_status='B'` |
| C - Revise and Resubmit | Revise & Re-Submit | DAR_REJECTED | 현재 라운드 `rN_dar_actual` + `rN_response_result='C'`, `latest_status='C'` (다음 라운드 파생 트리거가 처리) |
| For Review | Under Workflow Review | SUBMITTED | 현재 라운드 `rN_submission_actual` (기존값 있으면 유지, HDEC 우선), `latest_status='UR'` |
| Submitted For Review | (빈값) | SUBMITTED | 위와 동일 규칙 (HDEC 값 우선) |
| For Review | Terminated | EXCLUDED | `is_excluded=true`, `latest_status='Terminated'` 원문 반영, 파생 날짜 미변경 |
| Cancelled | Cancellation Accepted | EXCLUDED | `is_excluded=true`, `latest_status='Cancelled'` 원문 반영, 파생 날짜 미변경 |

### 현재 라운드(n) 판별
- 기존 raw 데이터의 `rN_response_result` 채움 정도로 결정.
- R1 미완료 → n=1. R1 완료(A/B/C 채움) & R2 미완료 → n=2. R2 완료 & R3 미완료 → n=3.
- SUBMITTED semantic: 가장 낮은 "response_result 미결정" 라운드의 submission_actual.
- DAR_APPROVED / DAR_REJECTED semantic: 가장 낮은 "response_result 미결정" 라운드의 dar_actual.

### Submission 덮어쓰기 규칙 (HDEC 우선)
`For Review` / `Submitted For Review` 계열은 대상 `rN_submission_actual`이 **null일 때만** Date Modified로 채움. 이미 값이 있으면(HDEC 임포트에서 채워짐) 유지. `apply_fields`에 submission_actual이 선택되어도 이 규칙 유지.

### Excluded 처리
- `abd_items_raw.is_excluded boolean not null default false` 컬럼 추가.
- `is_excluded=true` 행은:
  - Progress 매트릭스, 대시보드 KPI, 상태 분포, S-Curve 등 모든 집계에서 제외.
  - Raw Data 페이지 **상단 카운트 배지**에서도 제외. 별도 "Excluded: N" 카운트를 나란히 표시.
  - Raw Data 그리드에는 노출(회색 처리 + "Excluded" 뱃지), 필터로 켜고 끌 수 있게 유지.
- `latest_status`는 원문(`Cancelled` / `Terminated`)을 그대로 저장 → 상세/그리드에서 실제 상태 확인 가능.

## 파일별 변경

### 1. `src/lib/abd/aconex-parser.ts`
- `resolveAconexMeaning(status, review)` 함수 도입 → `{ raw_status, raw_review, code_or_label, semantic: 'DAR_APPROVED'|'DAR_REJECTED'|'SUBMITTED'|'EXCLUDED'|'UNKNOWN', response_result: 'A'|'B'|'C'|null, latest_status_value }` 반환.
- `ParsedAconexRow` 에 `semantic`, `response_result` 추가.
- `is_excluded`는 semantic==='EXCLUDED'만 true.

### 2. `src/lib/abd/aconex-import.functions.ts`
- 매칭된 각 행에 대해 기존 라운드 상태 조회(`r1_response_result`, `r1_submission_actual`, `r2_...`, `r3_...`) 함께 SELECT.
- `resolveCurrentRound(existing, semantic)` 헬퍼로 n 결정.
- semantic 별 patch 구성:
  - **DAR_APPROVED**: `rN_dar_actual = date_modified`, `rN_response_result = 'A'|'B'`, `approval_date = date_modified`, `latest_status = 'A'|'B'`.
  - **DAR_REJECTED**: `rN_dar_actual = date_modified`, `rN_response_result = 'C'`, `latest_status = 'C'`. `approval_date`는 건드리지 않음.
  - **SUBMITTED**: 기존 `rN_submission_actual`이 null일 때만 `patch[rN_submission_actual] = date_modified`, `latest_status = 'UR'`.
  - **EXCLUDED**: `is_excluded = true`, `latest_status = raw_status`(Cancelled/Terminated 원문). 파생 날짜 필드 미변경.
- 항상 세팅: `aconex_status_raw`, `aconex_review_status_raw`, `aconex_date_modified`, `aconex_last_synced_at`, `source_import_log_id`, `updated_at`, `updated_by`.
- `SYNC_FIELD_KEYS` 재정의 → semantic 카테고리 4종 + 메타 필드로 UI 라벨 재구성:
  - `dar_response` (승인/반려 라운드 dar_actual, response_result, approval_date, latest_status)
  - `submission_actual` (SUBMITTED 항목의 rN_submission_actual — 빈 값만)
  - `exclude_flag` (Terminated/Cancelled → is_excluded, latest_status)
  - `aconex_metadata` (aconex_* raw 컬럼)
- Preview 결과 필드에 semantic 카운트 추가: `by_semantic: { DAR_APPROVED, DAR_REJECTED, SUBMITTED, EXCLUDED, UNKNOWN }`.

### 3. `src/components/abd/import/AbdAconexImportPage.tsx`
- 컬럼 선택 다이얼로그 시스템 필드 라벨을 새 semantic 4종으로 갱신.
- Document No.는 유니크키 잠금 유지.
- 파싱 후 preview 결과 카드에 semantic 카운트 배지 표시.

### 4. DB — `supabase--migration`
- `ALTER TABLE public.abd_items_raw ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false;`
- 인덱스: `CREATE INDEX IF NOT EXISTS idx_abd_items_raw_is_excluded ON public.abd_items_raw(is_excluded) WHERE is_excluded = false;`
- 다음 RPC/뷰에 `WHERE is_excluded = false` 기본 필터 추가 (필터 파라미터로 override 가능하게):
  - `abd_items_search`, `abd_items_counts`, `abd_items_facets`
  - `abd_progress_cells`, `abd_progress_totals`
  - `abd_dashboard_row1`, `abd_dashboard_row2`, `abd_dashboard_status_dist`, `abd_dashboard_approval_trend`, `abd_dashboard_attention_lists`, `abd_dashboard_crosscut`, `abd_dashboard_overdue_heatmap`
- `abd_items_counts` 반환에 `excluded_count` 필드 추가 (전체 - 필터된 excluded=false 카운트).

### 5. `src/components/abd/raw-data/AbdRawDataPage.tsx`
- 상단 카운트 배지: `Total (excl. Excluded): N`, 옆에 `Excluded: M` 별도 표시.
- 그리드 행: `is_excluded=true` → 배경 `bg-muted/40 text-muted-foreground` + `Excluded` 뱃지.
- 컬럼 필터 드롭다운에 `Excluded 포함/제외` 토글 (기본: 제외).

### 6. `src/components/abd/raw-data/AbdDetailSheet.tsx`
- 헤더에 `Excluded` 뱃지 (해당 시).

## 검증
1. 유첨 파일 preview → `DAR_APPROVED: 2,741 / DAR_REJECTED: 120 / SUBMITTED: 407 / EXCLUDED: 225` 카운트 확인.
2. 임의 apply 후:
   - A 행 → `r1_dar_actual` + `r1_response_result='A'` + `approval_date` 세팅 확인.
   - C 행 → `r1_dar_actual` + `r1_response_result='C'`, `approval_date` 미변경, R2 활성화 확인.
   - For Review 행: 기존 `r1_submission_actual`이 null → 채워짐 / 기존 값 있음 → 유지.
   - Terminated/Cancelled 행 → `is_excluded=true`, `latest_status`에 원문 반영, 라운드 날짜 미변경.
3. Raw Data 상단 카운트에서 Excluded 225건이 총계에서 빠지고 별도 배지에 225로 표시.
4. Progress 매트릭스, Dashboard KPI에서 Excluded 행 제외 확인.
5. R1 완료 상태에서 A가 재임포트 → R2 DAR로 라우팅.
