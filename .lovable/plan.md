## 목표
Task Raw Data 테이블에서 **셀 인라인 편집 UI 제거**, 그리고 **행 아무 곳이나 클릭하면 해당 Task 상세페이지(`/closure/task-management/detail/$id`)로 드릴다운** 이동.

## 변경 파일

### 1. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`

- **인라인 편집 제거**
  - `EditCellPopover` import 및 컬럼 렌더러의 `EditCellPopover` 래핑 블록(약 619~634줄) 삭제 → 셀은 항상 `rendered`만 반환.
  - `actual_progress` parent 예외 분기와 함께 편집 관련 조건분기 정리.
  - `canEdit`/`refetch` 의존성 중 편집 셀 전용으로만 쓰이던 부분 정리(다른 곳에서 계속 사용되므로 변수 자체는 유지).
  - Task No 셀의 `<Link>`(약 572~579줄)는 유지하되, 이제 행 전체가 드릴다운되므로 중첩 링크 대신 그냥 텍스트로 렌더(부모 링크 안에 링크 중첩 금지). Task No의 collapse 버튼, "+ 하위 태스크 추가" 버튼, "History" 버튼은 그대로 유지하고 각자 `e.stopPropagation()`으로 행 클릭 전파 차단.

- **행 클릭 드릴다운**
  - 가상화된 행 wrapper `<div>`(1025줄)를 `<Link to="/closure/task-management/detail/$id" params={{ id: String(row.original.id) }}>`로 감싸거나, `useNavigate`로 `onClick` 핸들러 부여. TanStack 규칙상 `<Link>` 사용 권장 → wrapper를 `Link`로 교체하고 기존 스타일/`style`(transform, width, height) 유지, `className`에 `cursor-pointer` 추가.
  - Select 체크박스 셀, Task No 셀 내 버튼들, History 버튼, 하위 태스크 추가 버튼 등 기존에 `stopPropagation` 걸린 요소들은 그대로 두고, 링크 클릭 무효화를 위해 `e.preventDefault()`도 함께 호출하도록 보강.
  - Task No 컬럼 내부의 collapse/expand 버튼도 `preventDefault + stopPropagation` 처리.

### 2. `src/components/task-management/raw-data/EditCellPopover.tsx`
- 다른 곳에서 참조 없으면 파일 삭제(먼저 `rg`로 확인). 참조 남으면 파일 유지하고 import만 제거.

## 유지 사항
- 상세페이지(`TaskDetailPage`)에서의 편집 기능은 그대로 유지(관리자 전용 `EditCellPopover` in `src/components/task-management/detail/`).
- Bulk Edit Bar, ColumnFilter, Sort, History Drawer, Add Child Dialog 등 기존 기능 모두 유지.
- 행 선택 체크박스는 클릭해도 드릴다운되지 않도록 `stopPropagation` 확인.

## 검증
- `bunx tsgo --noEmit` 통과
- 프리뷰에서 (1) 행 아무 셀 클릭 → 상세페이지 이동, (2) 체크박스/History/Collapse/+ 버튼 클릭 → 드릴다운 안 됨, (3) 셀에 편집 팝오버 뜨지 않음 확인.
