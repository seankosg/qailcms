## ABD Progress 페이지 구현 계획

Snag Progress(SM Progress)의 UI/로직을 최대한 그대로 이식하여 `/closure/abd/progress` 페이지를 신규 생성하고, ABD Raw Data(`abd_items_raw`)를 기반으로 화면 캡쳐와 동일한 형태의 Progress Matrix 테이블을 렌더링합니다. S-curve/곡선 차트는 현재 범위에서 제외합니다.

### 사용자가 제안한 "라운드 무관, 최종 Draft/Submission/Approval 3-Stage" 방식의 문제점

- **히스토리 손실**: R1이 종료되고 R2가 시작되면 "최종 Draft"가 R2의 것으로 덮이면서 R1의 실적 카운트가 매트릭스에서 사라집니다.
- **Plan/Actual 라운드 미스매치**: "최신 Draft plan"과 "최신 Submission plan"이 서로 다른 라운드일 수 있어 같은 행에서 비교하면 Variance/누적 수치가 왜곡됩니다.
- **"최신"의 정의 모호**: 여러 라운드가 동시 진행 중인 항목에서 카운트가 이중/누락됩니다.
- **Approval 페어링 문제**: `Latest Status='A'`가 어떤 라운드의 승인인지 사라지며, 재작업(R1 승인 후 R2 진행) 시 카운트가 불가합니다.
- **미래 라운드 미노출**: R2/R3의 미래 Plan이 별도 시점에 노출되지 않습니다.

### 권장 방식 (이 계획의 기본)
- **Stage = Draft / Submission / DAR** (SM의 Start/Rect/Close 자리에 대응).
- **Round 토글 필터(R1/R2/R3/All)**로 어느 라운드 사이클을 볼지 결정.
- **Latest Status='A' 항목**: DAR Stage의 Actual 날짜로 `approval_date`를 우선 사용, 없으면 해당 라운드 `rN_dar_actual` 사용.
- 이렇게 하면 SM 매트릭스의 "Plan vs Actual 셀", "Total Scope", "Up To Data Date" 구조를 ABD에 그대로 적용하면서 라운드 반복 구조도 정확히 표현합니다.

### 구현 범위

#### 1. 페이지/라우트
- 신규 파일: `src/routes/_authenticated/closure/abd/progress.tsx`
  - `validateSearch`로 `plot`(C|D), `teams`(csv), `groupBy`(csv), `stageView`(csv), `bucket`(day|week), `range`(30/60/90/180), `hidePast`(0|1), `asofMode`(dataDate|today), `planMode`(baseline|remaining), `round`("R1"|"R2"|"R3"|"all") 정의.
  - SM `progress.tsx`의 스키마 구조를 그대로 복제, `round`만 추가.
- ABD 사이드바 메뉴에 "Progress" 링크 추가.

#### 2. 유틸
- 신규: `src/lib/abd/progress-utils.ts` — `progress-utils.ts`를 복제 후 아래 조정.
  - `Stage = "draft" | "submission" | "dar"`, 라벨 `Draft/Submission/DAR`.
  - `ALL_GROUP_BY = ["team","dis","service","pic","doc_ax","doc_axx"]`, 라벨/URL 파라미터 매핑 재정의.
  - `stageDateField(stage, field, round)` — 라운드 별 컬럼(`r{n}_drafting_plan/actual`, `r{n}_submission_plan/actual`, `r{n}_dar_plan/actual`) 반환. Approval 클릭 시 `approval_date` 이동.
- `assembleMatrix`, 버킷/날짜 유틸은 그대로 재사용.

#### 3. 서버 함수 & DB RPC
- 신규 서버 함수: `src/lib/abd/progress.functions.ts` — SM의 `progress.functions.ts` 구조 복제. `getAbdProgressCells`, `getAbdProgressTotals`.
- 신규 RPC(마이그레이션): `abd_progress_cells`, `abd_progress_totals`.
  - 입력: `_plots text[]`, `_teams text[]`, `_group_by text[]`, `_bucket`, `_range_start`, `_range_end`, `_as_of_date`, `_plan_mode`, `_round text`.
  - 로직:
    - Draft: `r{n}_drafting_plan` / `r{n}_drafting_actual`
    - Submission: `r{n}_submission_plan` / `r{n}_submission_actual`
    - DAR: `r{n}_dar_plan` / `COALESCE(approval_date WHEN latest_status='A' AND 해당 라운드가 최신 라운드, r{n}_dar_actual)`
    - `_round='all'`이면 3개 라운드 합산, 특정 라운드면 해당 라운드만.
    - `plan_mode='remaining'`: actual 존재 시 plan 무시(SM과 동일).
  - `total/done_upto/plan_upto/actual_upto`는 SM RPC와 동일 산식으로 계산.
- GRANT: `authenticated`, `service_role`.

#### 4. UI 컴포넌트
- 신규: `src/components/abd/progress/AbdProgressPage.tsx` — `SnagProgressPage.tsx` 복제 후 아래 변경.
  - 헤더 타이틀 "ABD Progress Status".
  - `DeSnagRoomGroupFilterBar` 제거(ABD에는 Room Group 없음).
  - 툴바 순서: Plot(C/D) → Team → **Round(R1/R2/R3/All)** → Group → Stage → Bucket → Range → HidePast → As-of → Plan.
  - Stage 토글 라벨을 Draft/Submission/DAR로.
  - 셀 클릭 이동 URL을 `/closure/abd/raw-data`로.
- 신규: `src/components/abd/progress/AbdScheduleMatrix.tsx` — `SnagScheduleMatrix.tsx` 복제, Stage 라벨/색상만 조정. 스티키 컬럼은 100% 불투명 배경 유지(프로젝트 코어 규칙 준수).
- ABD 팀 툴바는 `DeSnagToolbar` 재사용(팀 키 동일). 필요 시 `AbdTeamToolbar`를 얇게 신설.

#### 5. Raw Data 이동 규칙
- 셀 클릭 시 파라미터: `plot`, `team`, `dis`, `service`, `pic`, `doc_ax`, `doc_axx`, `round`, `dateStart`, `dateEnd`, `dateField`(`r{n}_drafting_actual` 등), `stage`. ABD Raw Data 페이지의 URL 필터 스키마와 호환되도록 매핑. 필요 시 `raw-data.tsx`의 `validateSearch`에 `dateStart/dateEnd/dateField/stage/round` 파라미터 추가.

#### 6. 검증
- `tsgo` 타입체크.
- Playwright: `/closure/abd/progress`에서 Plot C, Round=R1, Bucket=Day, Range=90d 상태로 매트릭스가 렌더되고, 하나의 셀 클릭 시 Raw Data가 해당 필터로 이동함을 확인.

### 기술 노트
- SM의 `planGroupsForPlot`은 ABD에 무관 → RPC 파라미터에서 제거하고 `_plots`(단일값 배열)로 전환.
- `data_date` 개념이 ABD에도 별도로 없어 `asOfDate=today`로 동일하게 사용. 향후 `data_date` 컬럼 활용 시 확장 가능.
- Latest Status='A'의 승인 앵커: 항목별 최신 라운드(가장 큰 n 중 `r{n}_dar_actual` 또는 계획 존재)에만 `approval_date`를 사용. 재작업(A 이후 새 라운드 시작)도 그대로 카운트.

### 결과물 파일
- 신규: `src/routes/_authenticated/closure/abd/progress.tsx`
- 신규: `src/lib/abd/progress-utils.ts`
- 신규: `src/lib/abd/progress.functions.ts`
- 신규: `src/components/abd/progress/AbdProgressPage.tsx`
- 신규: `src/components/abd/progress/AbdScheduleMatrix.tsx`
- 신규: DB 마이그레이션(`abd_progress_cells`, `abd_progress_totals` RPC + GRANT)
- 수정: ABD 사이드바 메뉴, ABD Raw Data 라우트 `validateSearch`
