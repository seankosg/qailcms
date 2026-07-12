# Task Raw Data 상세 페이지 구현

Defect Raw Data의 `DefectDetailPage`와 동일한 레이아웃/기능을 Task Management Raw Data 에 이식합니다. 기존 Task 편집·이력 인프라(`EditCellPopover`, `getTaskHistory`, `TM_COLUMNS`, `useTaskManagementFieldConfig`)를 재사용하여 프론트엔드/프레젠테이션 계층 작업만 수행합니다.

## 결과물

- 새 라우트: `/closure/task-management/detail/$id`
  - Task raw 행의 `id`(uuid) 기준 단건 조회 → 파일 기반 라우트로 자연스러운 딥링크.
- 새 컴포넌트: `src/components/task-management/detail/TaskDetailPage.tsx`
- Raw Data 테이블의 각 행에서 상세로 이동하는 진입점 추가 (`task_no` 셀 클릭 → Link).

## 화면 구성 (Defect 상세와 동일 패턴)

```text
┌─ Header ────────────────────────────────────────────────┐
│ [← 목록]  Task No · <Discipline 배지> · <Team 배지>       │
│                                          [Refresh]      │
├─────────────────────────────────────────────────────────┤
│ 2/3 col : Field Groups (Identification/Task/Status/     │
│           Plan/Actual/Forecast/System)                   │
│ 1/3 col : Status History (getTaskHistory)                │
└─────────────────────────────────────────────────────────┘
```

- 필드는 `TM_COLUMNS`의 `group` 기준으로 묶어 카드형 섹션으로 렌더 (Defect의 `GROUP_LABELS` 방식과 동일).
- 라벨은 `useTaskManagementFieldConfig` 훅으로 사용자 정의 라벨 우선 적용.
- 값 표시 규칙 (Defect의 `renderFieldValue` 미러):
  - `badge`(discipline/team/status_manual/risk/auto_judgment/plot/row_type/level) → 해당 색상 팔레트 배지
  - `date` → `formatDdMmm`
  - `percent` → `0.0%` 포맷
  - `number` → tabular-nums
  - 빈값 → `—` (muted)
- 편집 가능 필드(`c.editable && isAdmin`) 는 기존 `EditCellPopover` 로 래핑, `onSaved` 시 `refetch`.
- Status History 카드: `getTaskHistory({ discipline, task_no })` 서버 함수를 `useQuery`로 호출 → `HistoryDrawer` 와 동일한 timeline 스타일로 인라인 렌더 (field · source badge · old→new · 시각).

## 데이터 조회

- 상세 행: `supabase.from("task_management_raw").select("*").eq("id", id).maybeSingle()`
- 이력: 조회된 row 의 `discipline`, `task_no` 를 사용해 `getTaskHistory` 호출.
- 권한: `useCurrentUser().isAdmin` 로 편집 가능 여부 판단 (Defect 상세와 동일).

## Raw Data 페이지 진입점

`TaskManagementRawDataPage.tsx` 의 `task_no` 셀 렌더링에 `<Link to="/closure/task-management/detail/$id" params={{ id: row.id }}>` 추가. 인라인 편집·정렬·필터 동작을 유지하기 위해 클릭 이벤트는 stopPropagation 하지 않고 링크는 셀 내부 텍스트에만 씌웁니다. (기존 다른 편집 UX 변경 없음)

## 변경/추가 파일

- 추가
  - `src/components/task-management/detail/TaskDetailPage.tsx`
  - `src/routes/_authenticated/closure/task-management/detail.$id.tsx`
- 수정
  - `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` : task_no 셀에 Link 감싸기 (1개 렌더러만 변경)

## 범위 밖 (변경 없음)

- 서버 함수 신규 추가 없음 (기존 `getTaskHistory`, `EditCellPopover` 내부 supabase 업데이트 재사용).
- 스키마/RLS/마이그레이션 변경 없음.
- Defect 상세페이지 자체 변경 없음.
