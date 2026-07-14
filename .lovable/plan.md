## 목표
Task Raw Data에 Defect의 `DefectStageProgress`와 동일한 스타일의 2단계 Progress 아이콘 컬럼을 추가. Task No 바로 오른쪽에 위치. Data Date를 기준으로 Plan/Actual을 비교하여 Start·Finish 각각을 Plan / WIP / Delay / Completed 4상태로 색상 표시.

## 상태 판정 규칙 (Data Date = `data_date`, 없으면 오늘)

### Start pip
- **Completed** (녹색 ●): `actual_start` 존재
- **Delay** (빨강 ⊘): `actual_start` 없음 AND `plan_start` ≤ Data Date
- **Plan** (회색 ○): `actual_start` 없음 AND `plan_start` > Data Date
- **WIP** (황색 ◐): 사용 안 함 (Start는 이분값). 단, 예외적으로 `plan_start == Data Date` 이며 아직 시작 안 한 경우 Delay 처리.

### Finish pip
- **Completed** (녹색 ●): `actual_finish` 존재
- **WIP** (황색 ◐): `actual_start` 존재 AND `actual_finish` 없음 AND `plan_end` > Data Date (또는 진행 중)
- **Delay** (빨강 ⊘): `actual_finish` 없음 AND `plan_end` ≤ Data Date
- **Plan** (회색 ○): 그 외 (아직 시작 전이며 계획도 미래)

빈 값은 empty(옅은 회색). Tooltip에 `Start: <상태> · <실제/계획 날짜>`, `Finish: <상태> · <날짜>`, `Data Date: <date>` 표시.

## 변경 파일

### 1. 신규 `src/components/task-management/raw-data/TaskStageProgress.tsx`
- `DefectStageProgress` 스타일 그대로 (색상/글리프/`Pip` 컴포넌트 재사용 형태). Defect 파일을 직접 재사용하지 않고 별도 파일로 만드는 이유: 단계 이름(Start/Finish)과 판정 로직이 다름.
- 색상 매핑:
  - completed → `bg-emerald-600 border-emerald-600 text-white` (●)
  - wip → `bg-amber-400 border-amber-500 text-white` (◐)
  - delay → `bg-destructive border-destructive text-destructive-foreground` (⊘)
  - plan → `bg-transparent border-muted-foreground/40 text-muted-foreground/60` (○)
- `classifyStart(row, dataDate)`, `classifyFinish(row, dataDate)` 순수 함수 export.
- 두 pip 사이 짧은 연결선(`h-px w-2 bg-muted-foreground/30`) 유지.

### 2. `src/lib/task-management/columns.ts`
`TM_COLUMNS` 배열의 `task_no` 항목(줄 100) 바로 아래에 신규 컬럼 삽입:
```ts
{ key: "stage_progress", label: "Progress", type: "text", width: 80, group: "status" },
```
- `type: "text"` 로 두되 실제 렌더링은 페이지 쪽에서 특수 처리 (셀 값은 없음, 아이콘만).
- editable 없음, filter 대상 아님 (기존 `TM_SEARCH_FIELDS` 미포함).

### 3. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- 컬럼 렌더링 스위치(약 518행 근처)에 `stage_progress` 케이스 추가:
  ```tsx
  if (c.key === "stage_progress") {
    return <TaskStageProgress row={rr} dataDate={rr.data_date ?? null} />;
  }
  ```
- 헤더는 짧게 "Progress" 표기. 정렬/편집 비활성.
- `DEFAULT_ORDER`가 `task_no`를 제외하고 나머지를 순서대로 넣으므로 `TM_COLUMNS`에서 `task_no` 다음에 두면 자동으로 좌측 첫 데이터 컬럼이 됨. Frozen 여부는 사용자 요구가 "옆에 위치" 정도라 프로즌은 하지 않음(스크롤 시 함께 이동).
- 컬럼 헤더 필터 UI에서 `stage_progress`가 필터 옵션에 나오지 않도록: `type: "text"` 자체는 필터 가능하지만, `editable=false`이며 값이 비어 있어 실제로 필터로 잡히지 않음. 필요 시 별도 옵트아웃 처리는 후속으로 미룸.

### 4. 컬럼 순서 저장(user_view_preferences) 호환
- 신규 키 `stage_progress` 는 기존 저장된 순서에 없을 수 있음. `TaskManagementRawDataPage.tsx` 의 순서 병합 로직(230~235행)에서 새 키는 기본 위치(=`TM_COLUMNS` 정의 순서)로 끼워 넣도록 확인. 이미 `validKeys` set으로 필터링하고 있으므로 새 키는 저장된 순서 뒤에 오게 되어 원하는 "Task No 옆" 위치가 아닐 수 있음.
- 대응: 저장된 order에 `stage_progress` 없으면 `frozenExtras` 뒤 첫 위치에 강제 삽입 (약 384~385행 근처의 최종 배열 구성 시).

## 검증
- `bunx tsgo --noEmit`
- 미리보기에서 `/closure/task-management/raw-data` 접근 → Task No 오른쪽에 두 원형 아이콘이 보이고, 다음 케이스 각각 눈으로 확인:
  - `actual_start`/`actual_finish` 모두 있음 → 녹·녹
  - `actual_start`만 있음, `plan_end` 미래 → 녹·황
  - `plan_start` 과거, actual 없음 → 빨·빨(또는 빨·빨/plan)
  - 계획만 있고 아직 미래 → 회·회
- Tooltip이 각 pip의 상태와 날짜를 보여주는지 확인.

## 변경 파일 요약
- 신규: `src/components/task-management/raw-data/TaskStageProgress.tsx`
- 수정: `src/lib/task-management/columns.ts`
- 수정: `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
