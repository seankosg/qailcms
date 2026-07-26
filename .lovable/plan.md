# TM/SM Raw Data KPI 정합성 단순화(SHAW 방식) 및 검증 계획

## 목표
Dashboard KPI 카드의 숫자와 Raw Data 테이블 행 수가 정확히 일치하도록, SHAW PROJECT CMS의 단순한 "카드 숫자 = 행 수" 구조를 적용합니다. 동일한 데이터를 두 화면이 서로 다른 판정 소스로 읽어 발생하는 불일치를 근본적으로 제거합니다.

## 현재 확인된 사실
- TM Dashboard "Behind Schedule - ELEC" 카드: 51건
- TM Raw Data 진입 시 동일 조건의 헤더 배지: 42 / 1,440
- Dashboard KPI 는 `kpi-utils.ts`의 `gapAt < 0 && !isCompleted` 직접 계산으로 산출
- Raw Data 는 현재 Data Date(=최신 Data Date)일 때 DB에 저장된 `auto_judgment` 컬럼 값을 그대로 사용
- `tm_judge_at_date` RPC는 Dashboard와 동일한 gap 축 판정을 수행하며, 현재 Raw Data에서는 과거 Data Date 조회에만 사용 중

## 루트 원인
현재 Data Date에 대해 Raw Data 가 Dashboard 와 다른 진실원(DB 저장값)을 사용하여 필터링하기 때문에, 저장된 `auto_judgment` 가 gap 계산과 어긋난 9건(ELEC 기준)이 누락됩니다.

## 단계별 계획

### 1. TM Raw Data 의 판정 소스 단일화
- `TaskManagementRawDataPage.tsx`에서 `useTmJudgmentAtDate` 호출 시 현재 Data Date에도 활성화
- 서버 RPC `tm_judge_at_date` 로 재계산된 `auto_judgment`를 Raw Data 행에 항상 병합
- 기존 `modeToColumnFilters` 는 유지하되, 이제 동일한 gap 축 기준 `auto_judgment`로 필터링되도록 변경
- 데이터 소스를 단일화하여 Dashboard KPI 와 Raw Data 행 수가 일치하도록 함

### 2. Raw Data UI/UX 단순화 (SHAW 방식)
- 헤더 배지의 `매치 / 컨텍스트` 구조를 `X / Y` 단일 카운트로 교체
- Dashboard → Raw Data 딥링크 URL 파라미터는 추상적 `mode` 대신 실제 필터 값 중심으로 노출
- 불필요한 `kpiSelection`, `hideContextSubs`, `delayMode` 등 레거시 상태 제거

### 3. SM(Defect) 모듈 동일 적용 검토
- `DefectRawDataPage.tsx`에서 SM Dashboard KPI 와 Raw Data 간 동일한 불일치 패턴이 있는지 확인
- Dashboard KPI 산식과 Raw Data 필터 소스가 다르다면, 동일한 서버 재계산/단순화 방식 적용
- SM 용 서버 재판정 RPC 또는 동일한 필터링 방식이 있는지 우선 조사 후 반영

### 4. 검증
- Dashboard KPI 카드 클릭 → Raw Data 진입 시 헤더 카운트와 실제 테이블 행 수가 Dashboard 숫자와 정확히 일치하는지 확인
- ELEC, MECH 등 주요 팀별로 Behind Schedule / In Delay / Critical / Completed 등 주요 KPI에 대해 정합성 체크
- Playwright 자동 테스트로 Dashboard → Raw Data 딥링크 시 카운트 일치 여부 검증
- SM 모듈에도 동일 검증 적용

## 예상 효과
- Dashboard 의 KPI 숫자를 클릭하면 Raw Data 의 행 수가 정확히 같은 숫자가 됩니다.
- 더 이상 "매치 / 컨텍스트" 같은 중간 개념으로 사용자를 혼란스럽게 하지 않습니다.
- TM, SM 모두 동일한 판정 소스를 사용하여 모듈 간 일관성이 확보됩니다.

## 기술적 세부사항
- `useTmJudgmentAtDate`의 `enabled` 조건을 `!!isPastDate`에서 `true`로 변경
- `effectiveRows`의 `mergeTmJudgment`는 이미 `auto_judgment`, `gap_pct`, `delay_days`만 덮어쓰므로 Actual% 관련 컬럼은 영향 없음
- `tm_judge_at_date` RPC는 `tm_compute_derived`를 사용하여 Dashboard의 `gapAt` 로직과 동일한 축으로 판정하므로, 별도의 클라이언트 판정 로직 추가 없이 일치 가능
- SM 의 경우 동일한 구조가 없다면, 별도의 서버 재판정 함수 또는 클라이언트 판정 통합을 우선 설계