## 목표
TM Dashboard 상단의 "Task Scope" 필터를 "Task Filter"로 변경하고, Discipline 6종(ARCH/MECH/ELEC/DESN/PRJC/SUPP) 다중선택 토글을 같은 줄에 추가한다.

## 변경 사항

### 1. `src/lib/task-management/kpi-utils.ts`
- 기존 `scopeItems(items, taskScope)` 옆에 `filterByDisciplines(items, disciplines: string[])` 헬퍼 추가.
- 빈 배열이면 전체 통과, 값이 있으면 `item.discipline`이 배열에 포함된 항목만 반환.
- 매칭은 대소문자 무시 + trim.

### 2. `src/components/task-management/dashboard/TmKpiCards.tsx`
- Props에 `disciplines: string[]`, `onDisciplinesChange: (v: string[]) => void` 추가.
- 라벨 `Task Scope` → `Task Filter`로 변경.
- 필터 바 레이아웃: 한 줄, 두 그룹으로 배치
  ```text
  [Task Filter] [All|Main|Sub]  │  [ARCH][MECH][ELEC][DESN][PRJC][SUPP]   1,234 items
  ```
  - 좌측: 기존 Scope 토글 그대로 (단일선택 유지, 개념상 배타적)
  - 세로 구분선(`Separator`)
  - 우측: Discipline 토글 그룹 (`ToggleGroup type="multiple"`) — 다중선택
- `scoped` 계산 후 `filterByDisciplines(scoped, disciplines)` 파이프라인 추가하여 KPI 계산에 반영.
- `goRaw()`에서 Raw Data 딥링크 시 `discipline=ARCH,MECH,...` 쿼리 파라미터로 전달 (기존 `ownerContext.discipline`과 유니온).

### 3. `src/components/task-management/dashboard/TmDashboardPage.tsx` (호출부)
- 로컬 state `disciplines: string[]` 추가 (기본 `[]` = 전체).
- `TmKpiCards`에 prop 전달.
- 대시보드 나머지 위젯(리더보드, Top50, 차트 등)에도 동일한 필터 적용 여부는 이번 스코프에서 제외 — KPI 카드 영역에만 적용. (필요 시 추후 확장.)

### 4. Raw Data 딥링크
- 기존 `discipline` 쿼리 파라미터 파싱 로직이 있으므로 그대로 재사용. 값이 여러 개면 콤마 조인.

## 스코프 제외
- 리더보드/차트/Top50 등 KPI 카드 밖 위젯에 Discipline 필터 자동 반영은 하지 않음 (사용자 지시가 KPI 상단 필터 한정).
- Sidebar 어디에도 신규 route 추가 없음. DB 스키마 변경 없음.

## 검증
- tsgo 타입 체크 통과.
- 대시보드 진입 → Discipline 토글 다중 선택 → KPI 숫자 감소 확인.
- Completed 카드 클릭 → Raw Data로 discipline 필터 포함 이동.
