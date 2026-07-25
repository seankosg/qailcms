# Task Tree — 탭(Discipline) 전환 시 기본값 자동 재적용

## 현재 동작
- `expanded`/`judgmentFilter`가 단일 상태로 유지되어 탭 전환 시 이전 discipline의 task_no 기반 `expanded`가 남고, 새 탭에서는 아무 것도 펼쳐지지 않음.
- `autoExpandedOnce`는 세션당 1회만 발동 → 첫 탭 이후로 자동 전체 펴기가 다시 실행되지 않음.
- `judgmentFilter`도 탭이 바뀌어도 그대로 유지 → 사용자가 다른 탭에서 조정한 값이 새 탭에 노출됨.

## 목표
탭(Discipline)을 새로 열 때마다 **기본값(전체 펼침 + "위험" 필터 선택)** 적용. 사용자가 그 탭에서 펼침이나 위험 필터를 수동으로 조정하면 이후 재방문 시 그 상태 유지.

## 구현

### 1. 상태를 discipline별로 분리 저장
`sessionStorage`의 뷰 상태 스키마 확장:
```ts
type PerDiscipline = {
  expanded: string[];
  judgmentFilter: string[];
  touched: boolean; // 사용자가 직접 조정했는지
};
type PersistedView = {
  discipline: Discipline;
  search: string;
  picFilter: string;
  scrollY?: number;
  perDiscipline: Record<Discipline, PerDiscipline>;
};
```
기존 키(`qail.task-tree.view-state.v2`) → **v3**로 버전업(구 스키마는 무시).

### 2. 탭 전환/최초 로드 시 자동 리셋
- discipline이 바뀌거나 mainTasks가 로드될 때 실행되는 effect:
  - `perDiscipline[discipline]?.touched === true`면 저장된 `expanded`/`judgmentFilter` 그대로 적용.
  - 아니면 기본값 적용: `expanded = 전체 mainTask.task_no`, `judgmentFilter = ["위험"]`.
- `autoExpandedOnce` 플래그 제거(1회 제한 대신 discipline별로 판정).

### 3. touched 마킹
- `toggleExpand`, `expandAll`, `collapseAll`, `judgmentFilter` 토글 핸들러에서 현재 discipline의 `touched=true`로 저장.
- `search`/`picFilter`는 전역 유지(현재와 동일).

### 4. 세부
- 파일 변경: `src/components/task-management/tree/TaskTreePage.tsx` 단일.
- 뒤로가기(Raw Data 드릴다운 복귀) 시나리오는 이미 discipline별 touched=true로 기록되어 있으므로 그대로 복원됨.

## 검증
- ARCH → 위험 필터 자동, 전체 펼침. MEP 클릭 → 위험 필터 자동, 전체 펼침. ARCH로 복귀 → 초기 그대로.
- MEP에서 필터를 "지연"으로 변경 후 ARCH → MEP 다시 클릭 시 "지연" 그대로 유지.
