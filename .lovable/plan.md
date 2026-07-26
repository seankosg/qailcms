## 배경 및 현재 파악한 사실

TM에서 발생했던 KPI-Raw Data 숫자 불일치의 근본 원인은 **판정 소스가 이원화**되어 있었기 때문입니다.
- Dashboard: `plan_progress` 컬럼을 SELECT 하지 않고 `computeTPlan`(계획일 기반 누계)으로 gap 계산.
- Raw Data: `plan_progress` 컬럼을 사용하여 gap 계산 → 임포트값이 다르면 결과가 달라짐.

SM/ABD의 구조를 실제로 열어 확인한 결과, 두 모듈은 **판정이 서버 RPC 한 곳에서만 이루어지고 클라이언트에서 재계산하지 않는** 구조입니다.

### SM (Snag)
- Dashboard: `defect_snag_dashboard_matrix` RPC — 스테이지 완료(Punch/1st/2nd/3rd/Closed) 카운트를 서버에서 집계.
- Raw Data: `defect_items_search` RPC — 동일한 DB 컬럼(`stage_*_done`, `status_group`)을 서버 필터로 조회.
- 딥링크: `plan_group / team / roomGroup / status_group` 파라미터를 그대로 서버 필터로 변환.
- 클라이언트 사이드 gap 재계산 없음 → TM식 이원화 문제 구조적으로 발생 불가.

### ABD
- Dashboard: `abd_dashboard_row1/row2` RPC — `status_group` 컬럼(approved/under_review/drafting/not_started + rs_delay/sb_delay/ds_delay/no_plan) 기준 집계.
- Raw Data: `abd_items_search` RPC — 동일한 `status_group` 컬럼을 서버 필터로 조회.
- `status_group` 값은 DB 트리거(`abd_compute_derived`)가 단일 산식으로 확정 저장 → 양측 동일.
- 클라이언트 재계산 없음 → 이원화 구조 없음.

## 결론(가설)

**SM/ABD는 TM과 달리 판정 소스가 이미 단일(서버 컬럼/RPC)이므로 KPI 카드 숫자와 Raw Data 행 수가 자연스럽게 일치**할 가능성이 높습니다. 단, 다음 조건에서만 불일치가 발생할 수 있습니다.
1. `status_group=rs_delay|sb_delay|ds_delay|no_plan` 등 파생 상태가 `abd_items_search` 서버 필터에서 처리되지 않는 경우.
2. Raw Data 초기 진입 시 `source=progress/dashboard` 외의 URL 파라미터(예: `filters=` JSON 잔재)가 남아 필터가 중복 적용되는 경우.
3. Dashboard 카운트가 `active/excluded` 등 기본 제외 조건과 Raw Data 기본값이 다른 경우.

## 진행 방식(선(先) 검증, 후(後) 수정)

TM처럼 무조건 클라이언트 판정 로직으로 통일하는 것은 오히려 SM/ABD의 단일 소스 구조를 깨뜨릴 수 있으므로, **먼저 실측으로 불일치 유무를 확인**한 뒤 필요한 부분만 최소 수정합니다.

### Step 1. 실측 검증 (Playwright)
- SM: Dashboard의 각 Room Group / 팀 / 스테이지 카드 3~4개를 클릭 → Raw Data 진입 후 `X / Y` 뱃지 확인.
- ABD: Row1(Approved/UR/DS/NS) 및 Row2(RS/SB/DS Delay, No Plan) 카드 각각을 클릭 → 카드 count 와 Raw Data 뱃지·행 수 비교.
- 결과를 표(카드값 / 뱃지값 / 실제 행 수 / 일치 여부)로 정리.

### Step 2. 불일치가 확인된 경우에만 수정
케이스별 최소 개입 원칙:

**A. 서버 필터 누락형** (예: `status_group=rs_delay` 미지원)
- `abd_items_search` RPC 또는 `toServerFilters`에 파생 상태 매핑을 추가하여 Dashboard와 동일 조건으로 필터링.

**B. URL 파라미터 잔재형**
- `urlSearch.source==='dashboard'` 진입 시 기존 `filters=` JSON을 리셋하고 딥링크 파라미터만 반영(SM은 이미 `source==='progress'`에서 처리; ABD/SM에 `dashboard` 소스도 동일 규칙 확장).

**C. 기본 스코프 불일치형**
- `includeInactive`, `excluded=hide/only/all` 기본값을 Dashboard 집계 스코프와 일치시킴.

**D. 순수 계산 불일치형(있을 경우)**
- TM 방식대로 KPI 산식과 Raw Data 판정 함수를 공용 유틸(`abd/kpi-utils.ts` 신설)로 통합.

### Step 3. Raw Data 헤더 뱃지 통일(TM과 동일한 UX)
- 불일치 조치 후 SM/ABD 모두 헤더 배지를 `X / Y`(현재 표시 / 전체) 단일 형식으로 정리.
- Dashboard 카드 숫자 = 뱃지의 X 값이 되도록 문구/툴팁 통일.

### Step 4. 검증
- Playwright로 Step 1과 동일한 시나리오를 반복 실행하여 카드값 = 뱃지값 = 실제 행 수가 모두 일치하는지 스크린샷으로 확인.

## 산출물
- 검증 리포트(어떤 카드가 몇 건 불일치였는지).
- 필요 시 수정된 RPC/서버 필터 매핑, URL 초기화 로직, 공용 kpi 유틸.
- 뱃지 UX 일관성 정리.

## 범위 밖(요청 없음)
- Dashboard/Raw Data의 카드 구성·정렬·색상 등 시각 요소 변경.
- 판정 임계값(임의 조정) 변경.

승인해 주시면 Step 1 검증부터 착수하고, 결과를 공유한 뒤 실제 수정이 필요한 부분만 진행하겠습니다.