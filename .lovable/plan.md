
# ABD Progress Matrix 필터 재구성

## 원칙
- Approved(`latest_status='A'`) 도면은 매트릭스/집계에서 완전 제외.
- 각 도면은 자신의 **현재 라운드**에서만 1회 카운트. 이전 라운드 스테이지는 표시 안 함.
- 결과적으로 DS/DF/SB/RS 4개 스테이지의 Total Scope는 동일(현재 라운드 미승인 도면 수).

## 현재 라운드 정의
`r{n}_draft_start_plan/actual`, `r{n}_draft_finish_plan/actual`, `r{n}_submission_plan/actual`, `r{n}_dar_plan/actual` 중 하나라도 값이 있는 최고 n(1~3). 아무 것도 없으면 R1.

## 변경 사항

### 1. DB (RPC 재작성)
`abd_progress_cells`, `abd_progress_totals` 두 함수를 재작성:
- base CTE에서 `latest_status='A'` 제외 추가.
- `current_round` 계산:
  ```sql
  GREATEST(
    CASE WHEN r3_ds_p IS NOT NULL OR r3_ds_a IS NOT NULL OR r3_df_p IS NOT NULL OR r3_df_a IS NOT NULL
              OR r3_sb_p IS NOT NULL OR r3_sb_a IS NOT NULL OR r3_rs_p IS NOT NULL OR r3_rs_a IS NOT NULL THEN 3 END,
    CASE WHEN r2_...any... THEN 2 END,
    1
  )
  ```
- `stage_expand`: 기존 `CROSS JOIN LATERAL (VALUES ... round 1/2/3 ...)` → 현재 라운드의 4행만 방출하는 `CASE` 기반 단일 세트로 축소.
- Round 필터: `_round='all'` → 그대로. `R1/R2/R3` → `current_round=n`인 도면만 통과.
- `approved_round` 로직 제거(A는 이미 제외됨).

### 2. Group Filter: Batch 추가
- `src/lib/abd/progress-utils.ts`
  - `GroupBy`에 `"batch_no"` 추가, `ALL_GROUP_BY`/`GROUP_LABELS`/`GROUP_QUERY_PARAM`에 반영("Batch").
- RPC의 group_by CASE branch에 `WHEN 'batch_no' THEN r.batch_no` 추가.
- `abd_items_raw`에 `batch_no` 컬럼 존재 확인됨.

### 3. Stage 라벨: 매트릭스 한정
- `STAGE_LABELS`는 그대로 두고, 매트릭스 표시 지점에서만 override 매핑 사용:
  - `draft_start → DS`, `draft_finish → DF`, `submission → SB`, `dar → RS`.
- 적용 위치:
  - `AbdProgressPage` 툴바 Stage ToggleGroup 라벨.
  - `AbdScheduleMatrix` 헤더의 스테이지 라벨.
- 대시보드/S-Curve 등 다른 화면 라벨은 변경하지 않음.

### 4. Data Date 캘린더 피커
- `AbdProgressPage`에 다음 추가:
  - `useAbdLatestDataDate` (신규) 또는 기존 dashboard hook 재사용해 latest `data_date`와 옵션 목록 로드.
  - `searchSchema`에 `dataDate: fallback(z.string(), "").default("")` 추가.
  - 헤더 우측(제목 옆)에 `DataDatePicker` 배치(SM와 동일 컴포넌트).
  - `asOfDate = dataDate || latestDataDate || todayIso()`.
  - `asofMode` 토글은 유지(“Today / Data Date”). Data Date 선택 시 자동으로 `asofMode='dataDate'`로 세팅.

### 5. 상단탭 재정렬 (2행 구성)
- **1행 (기본 스코프)**: Plot · Team · Round.
- **2행 (뷰 옵션)**: Group · Stage · Bucket · Range · Hide past · As-of · Plan mode.
- 각 그룹은 `ToolbarGroup` 라벨 + `border-l pl-3` 구분선으로 시각 분리.
- Header 우측에 `DataDatePicker` 노출(1행과 분리).

## 기술 세부
- `assembleMatrix` 시그니처 유지. 스테이지 라벨은 UI 레이어에서만 매핑.
- `handleCellClick`의 `stageDateField(stage, field, round)`: `round='all'`이면 도면별 현재 라운드를 알 수 없으므로, 셀 클릭 시 URL에 `round=current`를 전달하고 Raw Data 페이지에서 각 행의 `current_round` 계산해 필터. → 별도 이슈로 남기고 이번 변경에는 포함 안 함. 기본은 기존과 동일하게 UI 선택 라운드 사용(“current”가 아니라 선택값).
- Batch grouping 추가 시 group_key 배열 크기는 dim 개수와 동일하게 유지되므로 클라이언트 assembly 코드 무수정.
- Total Scope 동일성 검증: 새 RPC에서 stage_expand는 도면당 4행(DS/DF/SB/RS) 고정 → totals의 total은 stage 무관하게 동일. 미착수 라운드 카운트를 위해 total 계산은 `COUNT(*)` (pdate/adate 유무 무관)로 변경.

## 파일 변경 요약
- `supabase/migrations/*_abd_progress_current_round.sql` (신규): 두 RPC 재작성.
- `src/lib/abd/progress-utils.ts`: `GroupBy`에 `batch_no` 추가, `GROUP_LABELS`/`GROUP_QUERY_PARAM`/`ALL_GROUP_BY` 갱신, 매트릭스용 short label 상수 `STAGE_SHORT_LABELS` 추가.
- `src/routes/_authenticated/closure/abd/progress.tsx`: `searchSchema`에 `dataDate` 추가.
- `src/components/abd/progress/AbdProgressPage.tsx`: DataDatePicker 통합, 툴바 2행 재정렬, Stage 라벨 short 적용, Batch 그룹 옵션 노출.
- `src/components/abd/progress/AbdScheduleMatrix.tsx`: 스테이지 헤더 라벨을 `STAGE_SHORT_LABELS` 사용.
- (필요 시) `src/hooks/useAbdLatestDataDate.ts` (신규) 또는 기존 hook 재사용.

## 검증
- 타입체크 통과.
- Preview에서 Round=R1/R2/R3/All 전환 시 각 스테이지 Total 동일 확인.
- Batch 그룹 선택 시 배치별 행 생성 확인.
- Data Date 변경 시 매트릭스/토탈 재조회 확인.
