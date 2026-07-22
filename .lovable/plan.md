## 배경 조사 결과

**"Sub는 지연 아닌데 Main만 지연"의 실제 원인**

DB를 조사한 결과 로직 오류는 확인되지 않았습니다.

- `task_management_raw` 전체에서 `auto_judgment IN ('지연','위험')`인 Main 태스크 중, 그 Sub 태스크에 하나도 지연/위험이 없는 케이스는 **0건**이었습니다 (kpi-utils.ts:63–75, derived.ts:155–178 판정식 기준).
- 예: MECH `ME-D-13` (Main 지연 82.5%)는 6개 Sub 중 `ME-D-13-04`가 53%로 이미 "지연" 판정을 받고 있습니다. Main은 그 Sub 때문에 지연으로 롤업된 것입니다.
- 다만 나머지 Sub 5개는 "정상/주의/완료" 상태입니다. TM Raw Data 드릴다운은 각 행을 독립적으로 필터링(TaskManagementRawDataPage.tsx:470–505)하므로, Delay KPI 클릭 → Raw Data 진입 시 **Main 행과 지연된 일부 Sub만 노출**되고 "정상/주의" Sub는 사라집니다. 사용자 화면에는 "Main은 지연인데 Sub 목록이 비거나 빠져 보이는" 착시가 생깁니다.

즉 지연 판정 자체는 정상이며, 문제는 **드릴다운 필터의 표시 범위**입니다. 사용자의 요청(“Main이면 그 Sub도 같이 리스트업”)은 이 착시를 해소하는 정확한 처방입니다.

## 구현 범위

### 1. Delay 계열 KPI 드릴다운 시 Main → Sub 동반 노출

대상 mode(대시보드 `TmKpiCards.tsx`에서 라우팅되는 값): `in_delay`, `start_delayed`, `completion_overdue`, `critical`, `behind`. (완료/시작/계획 등 비지연 mode는 현행 유지.)

수정 파일: `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (`kpiFilteredRows` 메모, 대략 470–505행).

동작:
1. 기존 로직대로 각 행이 mode 조건에 매치되는지 판정하여 1차 매치 집합 `matched`를 구한다.
2. `matched` 안에 있는 `level='main'` 태스크의 `(discipline, task_no)`를 키로 모아 `mainKeys`를 만든다.
3. 전체 `scoped` 중 `level='sub'` && `(discipline, main_task_no) ∈ mainKeys` 인 Sub를 추가 포함시킨다 (mode 조건 무시).
4. Delay 계열 mode에서만 이 확장을 적용한다. 그 외 mode는 현행과 동일하게 `matched` 그대로 반환.
5. `taskScope` 처리: 사용자가 대시보드에서 "Sub Task"로 좁혀 진입한 경우엔 Main 자체가 이미 제거되어 있으므로 확장 대상이 없다(자연스럽게 no-op). "Main Task" scope 진입 시엔 Sub도 함께 보여야 하므로 이 확장 로직은 `scopeItems` 적용 이전 집합(전체 `delayFilteredRows`)을 대상으로 Sub를 재수집한다. → `scopeItems` 호출 순서 조정 필요.

Collapse 동작(`visibleRows`, 508–517행)은 그대로 활용 — 추가된 Sub는 접힌 부모라면 계속 접혀 있다.

### 2. Delay Top 테이블 (`지연 Top`) 링크에도 동일 처리 (있는 경우)

`DelayTopTable`에서 행 클릭으로 Raw Data 딥링크가 걸려있는지 점검. 걸려 있다면 동일 규칙 적용, 아니면 스킵.

### 3. UI 표시

Raw Data 상단의 KPI 딥링크 뱃지 라벨(라인 1084 부근)에 확장이 적용된 경우 `"(Sub 포함)"` 접미를 추가하여, 사용자가 지금 보고 있는 목록이 "지연 Main + 그 Main의 모든 Sub" 임을 명확히 표시.

### 4. 판정 로직 정합성 재확인(코드 수정 없음)

- `computeJudgment`(derived.ts:155–168)와 `isInDelay`/`isBehindSchedule`/`isCriticalDelay` (kpi-utils.ts:58–75) 는 Main/Sub 구분 없이 동일 필드(`plan_start`, `plan_end`, `actual_progress`, `actual_start`, `actual_finish`, `plan_days`)로 계산됨을 문서화 주석으로 명시.
- Main의 `actual_progress`는 DB 트리거 `update_task_summary`가 Sub 롤업으로 채우므로, "Sub 평균이 낮아 Main % 낮음 → Main 지연"이 정상 동작임을 코드 코멘트로 남긴다.
- 별도 데이터 마이그레이션 불필요(위 조사에서 불일치 케이스 0건).

## 검증 방법

1. 대시보드에서 `In Delay` 카드 클릭 → Raw Data 진입.
2. `ME-D-13` (Main 지연) 이 노출되는지, 그리고 그 6개 Sub 전체(정상/주의 포함)가 함께 노출되는지 확인.
3. `Start Delayed`, `Critical Delay`, `Behind Schedule` 카드에 대해서도 동일 확인.
4. `Completed` 카드는 확장 없이 매치 행만 노출되는지 확인(회귀 방지).
5. 대시보드 Task Filter를 "Sub Task"로 두고 지연 카드 클릭 시 Main이 나타나지 않는지 확인(scope 정합성).
