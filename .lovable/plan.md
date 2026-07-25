## 확인된 현재 상태

- `TaskTreePage.tsx`의 Main Task 뱃지는 `resolveJudgment(p, asOfDate)`를 통해 Main 행 자체의 `plan_start`, `plan_end`, `actual_progress`, `plan_progress`를 `computeJudgment`에 넣어 즉시 재계산하고 있습니다.
- `computeJudgment`는 Start/WIP/Finish 3단계 중 최악 상태를 선택합니다. 그래서 Main 행의 `actual_finish`가 비어 있고, `plan_end`가 기준일보다 지났거나 WIP gap이 임계값보다 작으면 Main 뱃지가 위험/지연으로 나올 수 있습니다.
- 실제 DB 조회 기준 `EL-G-04` Main 행은 `auto_judgment=위험`, `actual_progress=20%`, `plan_progress=20%`, `plan_start=2026-02-06`, `plan_end=2026-08-26`입니다. 반면 하위 Sub Task 10개는 완료 5개, 아직 계획일 전 정상 5개로, 화면 캡처처럼 하위에는 지연/위험이 없습니다.
- 따라서 현재 문제는 “하위 Sub Task 상태와 롤업 진도 기준”이 아니라 “Main 행 자체의 3-stage 판정값/날짜 필드”가 Main 뱃지에 직접 반영되는 구조입니다.

## 수정 원칙

Main Task의 위험/지연/주의/정상 뱃지는 다음 기준으로 판정하도록 바꾸겠습니다.

1. Main Task의 계획 진도율
   - Main Task의 롤업된 `plan_start` ~ `plan_end` 기간을 기준으로 기준일(`Data Date`)의 계획 진도율을 계산합니다.
   - 단, 기존 Main 행의 `plan_progress`가 이미 롤업 계획 진도율로 존재하면 현재 UI의 “오늘 계획”/차이 표시와 일관되도록 우선 사용합니다.

2. Main Task의 실적 진도율
   - 하위 Sub Task들의 `actual_progress`를 평균/롤업한 값을 기준으로 사용합니다.
   - Main 행의 `actual_progress`가 DB에서 이미 롤업되어 있더라도, Task Tree 화면에서는 하위 Sub Task 목록이 로드되어 있으므로 화면 표시 기준은 하위 Sub Task에서 재계산하여 일관성을 맞춥니다.

3. 하위 Sub Task 위험도 반영
   - 하위 Sub Task 중 위험/지연이 있으면 Main Task도 그 최악 상태를 반영합니다.
   - 단, EL-G-04처럼 하위 Sub Task가 모두 완료 또는 정상이고 Main 롤업 진도 차이도 0% 수준이면 Main은 정상으로 표시합니다.

4. 완료 판정
   - 모든 하위 Sub Task가 완료이거나 롤업 실적이 100%이면 Main은 완료로 표시합니다.
   - 완료 상태는 기존처럼 하단 정렬/회색 스타일과 충돌하지 않게 유지합니다.

## 구현 계획

1. `TaskTreePage.tsx`에 Main 전용 판정 헬퍼를 추가합니다.
   - 입력: Main row, 해당 Sub rows, `asOfDate`
   - 출력: Main 뱃지용 판정 문자열
   - Main 자체 `computeJudgment(main)` 직접 호출을 제거하고, Main 전용 롤업 판정으로 교체합니다.

2. Main 표시값도 같은 기준으로 정렬합니다.
   - Main 뱃지, 위험도 필터, 위험도 카운트가 모두 동일한 Main 전용 판정 함수를 사용하게 맞춥니다.
   - 현재처럼 필터에서는 위험인데 카드에서는 정상처럼 서로 다른 결과가 나오지 않도록 단일 계산 경로로 정리합니다.

3. Main 카드의 차이값(`+0.0%p`)도 하위 Sub Task 롤업 실적과 Main 계획 진도율 기준으로 맞춥니다.
   - EL-G-04는 하위 실적 50%, Main 계획 20%가 아니라 현재 캡처의 표시처럼 Main actual/plan 기준을 그대로 보여야 하는지 확인이 필요한 부분입니다.
   - 우선 이번 수정 범위는 “상태 뱃지 판정”이므로, 차이값은 기존 표시를 유지하되 뱃지 판정만 원칙 기준으로 고칩니다. 필요하면 다음 단계에서 차이값까지 동일 산식으로 통일하겠습니다.

4. 회귀 확인 대상
   - `EL-G-04`: 하위 Sub Task에 지연이 없으므로 Main 뱃지가 위험이 아닌 정상으로 표시되는지 확인합니다.
   - `ME-D-01`: 계획 대비 실적 차이가 0% 수준이면 위험으로 표시되지 않는지 함께 확인합니다.
   - 실제 위험/지연 Sub Task를 가진 Main은 기존처럼 위험/지연 필터에 계속 노출되는지 확인합니다.

## 기술 메모

- 수정 대상 파일: `src/components/task-management/tree/TaskTreePage.tsx`
- 공통 유틸(`derived.ts`)은 다른 Dashboard/Raw Data/KPI에서도 쓰이고 있어 즉시 변경하지 않고, Task Tree의 Main Task 표시 판정만 먼저 분리합니다.
- DB 구조나 데이터 마이그레이션은 하지 않습니다. 화면 판정 로직만 수정합니다.