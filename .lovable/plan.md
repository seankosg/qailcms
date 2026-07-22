## 목표
SM Progress 페이지의 KPI 카드(Total, Plan, Actual) 값 오른쪽 괄호 안에 `Total`을 기준으로 한 백분율을 표시한다. 이미 `(±X.X%)` 형태로 구현된 `Difference` 카드와 동일한 스타일/배치를 따른다.

## 현재 상태
- `src/components/defect-management/progress/SnagProgressPage.tsx` 내 `kpis` 객체는 `totalStages`, `cumPlan`, `cumActual`, `progressPct`, `planPct` 등을 계산하고 있다.
- `TOTAL`, `PLAN`, `ACTUAL` 카드는 현재 "순수 숫자" 값만 표시 중이다.
- `DIFFERENCE` 카드는 `suffix`로 `(±X.X%)`를 표시하고 있어 참조 스타일이 확보되어 있다.
- `PROGRESS` 카드는 이미 `(P X.X%)` 형태의 괄호 정보를 표시하고 있다.

## 변경 범위
파일: `src/components/defect-management/progress/SnagProgressPage.tsx`

### 1. KPI 수치 계산 보강
- `kpis` useMemo에 다음 값을 추가:
  - `totalPct`: `totalStages / totalStages * 100` (항상 100.0)
  - `planPctOfTotal`: `totalStages > 0 ? (cumPlan / totalStages) * 100 : 0`
  - `actualPctOfTotal`: `totalStages > 0 ? (cumActual / totalStages) * 100 : 0`
- 기존 `planPct`는 PROGRESS 카드 `(P ...)`용이므로 그대로 유지.

### 2. 카드별 suffix/괄호 추가
- **TOTAL 카드**
  - `suffix` 추가: `(100.0%)`
  - `stageBreakdown` 각 항목: `(100.0%)` (단, `total === 0`이면 `—`)
- **PLAN 카드**
  - `suffix` 추가: `(planPctOfTotal.toFixed(1)%)`
  - `stageBreakdown` 각 항목: `(byStage[s].plan / byStage[s].total * 100%)` (0이면 `—`)
- **ACTUAL 카드**
  - `suffix` 추가: `(actualPctOfTotal.toFixed(1)%)`
  - `stageBreakdown` 각 항목: `(byStage[s].actual / byStage[s].total * 100%)` (0이면 `—`)

### 3. 스타일
- Difference 카드와 같은 방식으로 괄호는 `text-[10px]` 크기, `tabular-nums`로 처리.
- 색상: Total은 `text-muted-foreground`, Plan/Actual은 필요시 `text-muted-foreground` 또는 카드 톤에 맞춘 색상 유지. 부호에 따른 변색은 Difference와 동일 로직을 적용하지 않음 (값 기준 %는 항상 0~100 범위).

## 검증
- 변경 후 로컬 프리뷰에서 SM Progress 페이지를 열고 Total/Plan/Actual 카드에 괄호 %가 추가되었는지 확인.
- Stage breakdown 항목에도 동일하게 %가 노출되는지 확인.
- PROGRESS 카드의 `(P X.X%)`는 그대로 유지되어야 함.

## 영향도
- 서버 RPC/DB 변경 없음.
- 다른 모듈(ABD, TM, DMR) 미변경.
- URLSearchParams, 라우팅, 클릭 핸들러 변경 없음.