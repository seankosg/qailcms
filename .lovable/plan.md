## SM Progress KPI 카드 개선

### 목표
SM Progress 페이지 상단 KPI 카드 영역에서 **DONE** 카드를 **TOTAL**로 변경하고, **PROGRESS** 카드에 계획 진도율을 괄호 안에 추가 표시합니다.

### 현재 상태
- KPI 카드 순서: `PLAN → ACTUAL → DIFFERENCE → DONE → PROGRESS`
- DONE 카드: `"완료수 / 전체수"` 형태로 표시 (예: `681 / 7,351`)
- PROGRESS 카드: 실적 진도율만 표시 (예: `52.3%`)
- DONE / PROGRESS 카드 클릭 시 활성 스테이지 전체 Raw Data 목록으로 이동

### 변경 사항
1. **DONE → TOTAL 라벨 변경 및 위치 이동**
   - `SnagProgressPage.tsx` 내 `<KpiCard label="DONE" ... />`를 `label="TOTAL"`로 변경
   - 카드 순서를 `TOTAL → PLAN → ACTUAL → DIFFERENCE → PROGRESS`로 재배치
   - 가장 왼쪽 첫 번째 카드로 이동
2. **TOTAL 카드 표시 값 단순화**
   - 기존 `"done / total"` 형태에서 활성화된 스테이지의 **total(전체 항목수) 합계만** 표시
   - Stage Breakdown도 각 스테이지별 `total` 값만 표시
   - 예시: `7,351` / 하단 브레이크다운 `Start: 3,100 · Rect: 2,800 · Closure: 1,451`
3. **TOTAL 카드 클릭 동작 유지**
   - TOTAL 카드 클릭 시 여전히 활성화된 스테이지의 전체 항목 Raw Data 목록으로 이동
   - `handleKpiClick("done", "all")` 호출 로직은 그대로 유지
4. **PROGRESS 카드에 계획 진도율 추가**
   - 실적 진도율(기존 값) 우측에 괄호 안에 계획 진도율 표시
   - 형식: `52.3% (Plan 48.5%)`
   - 계획 진도율 계산: `totalStages > 0 ? (cumPlan / totalStages) * 100 : 0`
   - Stage Breakdown도 각 스테이지별 실적 진도율 옆에 계획 진도율을 괄호로 추가
   - 예시: `Start: 52.3% (Plan 48.5%)`

### 수정 파일
- `src/components/defect-management/progress/SnagProgressPage.tsx`
  - KPI 카드 JSX 재배치 (TOTAL → PLAN → ACTUAL → DIFFERENCE → PROGRESS)
  - DONE 카드 라벨/값/브레이크다운을 TOTAL 기준으로 변경
  - PROGRESS 카드 값 및 Stage Breakdown에 계획 진도율 추가
  - 계획 진도율 계산값을 `kpis` 객체에 추가

### 검증 항목
- SM Progress 페이지 진입 시 가장 왼쪽 카드에 "TOTAL" 라벨과 총 항목수가 표시되는지 확인
- TOTAL 카드 클릭 시 Raw Data 페이지로 정상 이동하는지 확인
- PROGRESS 카드가 `실적% (Plan 계획%)` 형태로 표시되는지 확인
- Stage Breakdown이 각 스테이지별 실적 진도율과 계획 진도율을 함께 표시하는지 확인
- PLAN, ACTUAL, DIFFERENCE 카드의 기존 동작이 영향받지 않는지 확인