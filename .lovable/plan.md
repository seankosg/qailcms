## 목표
TMRD(Task Management Raw Data)에서 완료된 행(`isDone`)의 뱃지 텍스트와 progress 아이콘까지 회색으로 보이도록 처리.

## 현재 상태 (확인됨)
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` 1196행: `isDone = ap >= 0.999 || aj === "완료"`.
- 1211~1216행: 완료 행에 `bg-muted/40 text-muted-foreground/70` 적용 중.
- 그러나 자식 요소인:
  - `renderBadge`(143~160행) — `RISK_COLORS`, `STATUS_COLORS` 등 컬러 배경 뱃지
  - `AlarmBadge`, `TaskStageProgress` 진도 아이콘(색상 SVG/배지)
  들은 자체 색상을 갖고 있어 부모의 `text-muted-foreground/70`을 무시하고 원색으로 표시됨.

## 변경 사항
`TaskManagementRawDataPage.tsx` 1211~1216행 행 컨테이너의 `cn(...)`에 완료 조건일 때 `grayscale` (필요 시 `opacity-80`) 유틸리티 추가.

- `filter: grayscale(1)`은 자식 SVG/배경/텍스트 색상을 모두 회색조로 강제 변환하므로, 뱃지·아이콘의 개별 컴포넌트 수정 없이 일괄 회색 처리가 가능.
- 기존의 `bg-muted/40 text-muted-foreground/70`은 유지 (배경/텍스트 톤 다운 효과).
- Sticky 컬럼(1236행 `isFrozen && isDone ? "bg-muted"`)도 그대로 유지.

## 검증
- 완료 행(actual_progress=1 또는 auto_judgment="완료")의 risk/status/team 뱃지와 stage progress 아이콘이 회색으로 표시되는지 확인.
- 비완료 행의 색상은 영향 없어야 함.
