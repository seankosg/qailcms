## 스코프 확정
- **부모행 하이라이트 적용**: `level === "parent"` 인 행 전체를 진한 남색 `#305496` + 흰색 굵은 글씨로 렌더 (템플릿 부모행 스타일).
- **Gantt 캘린더 열 유지**: 이전 턴에 구현한 U 이후 일별 컬럼(계획/실제/지연 바, 금요일 회색, Today 세로선)은 그대로 포함.

## 변경 파일
**`src/lib/excel/styled-workbook.ts`**
1. `StyledSheetOptions`에 `rowStyleOverride?: (row) => { fillRgb?: string; fontColorRgb?: string; bold?: boolean } | null` 옵션 추가.
2. 데이터 셀 렌더 루프에서 override가 반환되면 해당 행의 모든 데이터 컬럼 스타일에 fill/font를 강제 적용 (그룹 fill / risk override보다 우선).
3. Gantt 캘린더 셀에도 동일 행 override의 `fillRgb`를 배경으로 적용해 부모행이 캘린더 영역까지 연속되도록 처리 (단, 실제 바 색상·Today 세로선·주말 회색은 override보다 우선하여 유지).

**`src/components/task-management/raw-data/ExportDialog.tsx`**
- `format === "view"` 분기에서 `rowStyleOverride` 전달:
  ```ts
  rowStyleOverride: (row) =>
    row.level === "parent"
      ? { fillRgb: "FF305496", fontColorRgb: "FFFFFFFF", bold: true }
      : null
  ```
- `format === "reimport"` 는 미전달 (기존 동작 보존).

## 검증
- `tsgo` 타입체크.
- 실제 데이터 내보내기 후 openpyxl로 확인: 부모행 남색+흰색, 자식행 그룹 fill 유지, Gantt 바/Today/금요일 로직 정상.

## 제외
- rollup 계산·트리 UI 변경 없음. `level` 값은 DB에 이미 존재하는 필드를 그대로 사용.
- 재임포트 스타일 변경 없음.