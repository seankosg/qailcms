## 목표
Task Raw Data의 **Progress 컬럼(3단계 아이콘: Start · Alarm · Finish)**에 전용 필터 UI를 추가해서, 각 단계 상태별로 필터링 가능하게 구현.

## 필터 스펙
- 단계별 체크박스 그룹 3개 (팝오버 하나에):
  - **Start**: Completed / WIP · (Start엔 없음) / Delay / Plan / Empty
    - 실제 사용 상태: `completed`, `delay`, `plan`, `empty`
  - **Alarm**: 완료 / 정상 / 주의 / 지연 / 위험 / Empty (`done`/`ok`/`caution`/`late`/`risk`/`empty`)
  - **Finish**: Completed / WIP / Delay / Plan / Empty
- 규칙: 그룹 간 **AND**, 그룹 내 **OR**. 한 그룹에서 아무것도 선택 안 하면 그 그룹은 제약 없음. 전체 미선택이면 필터 미적용.
- 각 옵션 옆에 해당 pip 아이콘 미리보기 표시(색·글리프 동일 재사용).
- Clear 버튼으로 초기화.

## 변경 파일

### 1. `src/lib/task-management/columns.ts`
- `TmFilterType` 유니온에 `"stage-progress"` 추가.
- `inferTmFilterType`는 그대로(파생 컬럼이라 명시적으로 지정).

### 2. `src/lib/task-management/filters.ts`
- `stageProgressFilterFn(row, columnId, filterValue)` 추가.
- `filterValue` 형태: `{ start?: StageState[]; alarm?: AlarmState[]; finish?: StageState[] }`.
- 각 단계 상태를 `classifyStart` / `classifyAlarm` / `classifyFinish`로 계산(`row.original` + `data_date` 사용) 후 OR/AND 규칙 적용.

### 3. `src/components/task-management/raw-data/TaskStageProgress.tsx`
- 이미 export된 `classifyStart` / `classifyFinish` / `classifyAlarm` 재사용.
- pip 스타일/글리프/라벨 맵도 필터 UI에서 사용할 수 있게 named export 추가(`STATE_STYLES`, `STATE_GLYPH`, `STATE_LABEL`, `ALARM_STYLES`, `ALARM_GLYPH`, `ALARM_LABEL`, `Pip`).

### 4. `src/components/task-management/raw-data/ColumnFilters.tsx`
- `StageProgressDropdown` 신규 컴포넌트 추가.
  - 3개 섹션(Start/Alarm/Finish) 각각 체크박스 리스트, 앞에 mini pip 표시.
  - `column.setFilterValue`로 `{ start, alarm, finish }` 저장, 빈 배열/전체 미선택 시 `undefined`로 클리어.
  - facet에서 카운트 표시(선택된 filter 미적용 상태 기준으로 계산: `column.getFacetedRowModel()`나 raw table에서 파생 계산이 어려우므로 이번 구현은 카운트 생략 또는 `column.getFacetedRowModel()?.rows`로 즉석 집계).
- `ColumnFilterDropdown`의 switch에 `filterType === "stage-progress"` 분기 추가.

### 5. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- `stage_progress` 컬럼 정의부 수정:
  - `enableColumnFilter: true`
  - `accessorFn: (r) => r` (또는 빈 문자열) — filterFn이 row.original 직접 사용하므로 실제 반환값 중요치 않음.
  - `filterFn: stageProgressFilterFn`
  - `meta: { filterType: "stage-progress", group: c.group }`
- 기존 헤더 렌더링 로직(`h.column.getCanFilter() && meta?.filterType`)이 자동으로 새 필터 아이콘 노출.

## 검증
- `bunx tsgo --noEmit` 통과.
- 프리뷰:
  1. Progress 헤더에 필터 아이콘 표시.
  2. `Start: Delay`만 선택 → Start pip이 빨간색인 행만 표시.
  3. `Alarm: 위험` + `Finish: Completed` → 두 조건 AND 충족 행만.
  4. Clear 클릭 → 필터 해제.
