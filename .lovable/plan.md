## 확정된 결정 요약

1. Gantt 타임라인(오른쪽 일자별 캘린더) — 완전 폐기
2. 파생 컬럼 수식 — 폐기, 정적 값으로 기록
3. 자동판정 / 진도차 / 지연행 색상 — export 시점 정적 fill로 대체
4. `설정` 시트 + Data Date 배너 D4 — 폐기
5. Import 시 자동판정/자동계산 컬럼은 원본 엑셀 값 무시하고 앱 DB에서 재계산

## 대상 자동계산 컬럼 (import 시 원본값 무시)

`src/lib/task-management/derived.ts` 및 `rollup.functions.ts` 기준.

- `plan_days` = `plan_end - plan_start + 1`
- `plan_progress` = Data Date 대비 계획 진척률
- `actual_progress` (부모행) = 자식 가중평균 (자식은 원본 유지)
- `progress_variance` = `actual_progress - plan_progress`
- `expected_progress_today`, `today_gap`
- `slip_days` = `forecast_end - plan_end`
- `auto_judgment` = 완료/지연/주의(미착수)/진행/예정
- 부모행의 `plan_start`, `plan_end`, `actual_start`, `forecast_end` 롤업값

Import parser(`src/lib/task-management/parser.ts`)와 upsert 경로에서 위 필드를 원본에서 읽지 않도록 하고, 저장 직후 rollup/derived 재계산을 강제합니다.

## Export 재작성 (`View` 포맷)

### 파이프라인 교체
- `xlsx-js-style` + ExcelJS + JSZip 3단 파이프라인 폐기
- SM과 동일한 `streamXlsxExport` (`src/lib/excel/stream-export.ts`) 사용
- Gantt 시트 개념 폐기 → 단일 시트 `Task Management`

### `stream-export.ts`에 추가할 훅
현재 SM에는 없는 3가지만 최소 추가:

1. `columnWidths?: Record<string, number>` — 컬럼별 wch
2. `numFmtByKey?: Record<string, string>` — 퍼센트/음수부호 numFmt
3. `cellStyleOverride?: (key, value, row) => { fillRgb?, fontColorRgb?, bold? } | null` — 정적 색상 적용용
4. `rowStyleOverride?: (row) => { fillRgb?, fontColorRgb?, bold? } | null` — 부모 행 강조용

### 정적 색상 규칙 (조건부서식 대체)
export 시점에 JS로 판정해 셀 fill로 기록:

- `auto_judgment === "지연"` → `#C00000` + 흰색 볼드
- `auto_judgment === "주의(미착수)"` → `#ED7D31` + 흰색 볼드
- `auto_judgment === "완료"` → `#548235` + 흰색 볼드
- `progress_variance < 0` (항목 제외) → `#FCE4D6`
- `progress_variance >= 0` AND `actual_progress > 0` (항목 제외) → `#E2EFDA`
- `auto_judgment === "지연"` 인 행의 `task_no` 셀 → `#FCE4E4`
- `risk === "High"` → `#ED7D31`
- `level === "parent"` 행 → `#305496` + 흰색 볼드

### 폐기 대상 (파일에서 완전 제거)
`src/lib/excel/styled-workbook.ts`:
- `applyGanttTemplate`, `buildSettingsSheet`, `applyCfViaExcelJs`, `sanitizeMergedCellXml`
- `CfRule`, `WorkbookCfSpec`, `cfBySheet`, `maskMergedInnerCells`
- Gantt 관련 상수(`GANTT_BAR`, `GANTT_HEADER_FILL`, `GANTT_DATA_FILL`, `GANTT_TITLE`, `GANTT_DATA_DATE`, `gGanttCellStyle`, `daysBetween`, `isoInRange`)
- `StyledSheetOptions`의 `gantt`, `formulaMode`, `settingsSheet`, `dataDate`, `columnGroup`, `theme="gantt"` 분기

파일이 사용되는 다른 곳은 `src/lib/defect-management/bulk-actions.ts` 뿐이며 `theme` 기본값(default)만 쓰므로 영향 없음. Gantt 브랜치만 제거하고 default 브랜치는 유지합니다.

`src/components/task-management/raw-data/ExportDialog.tsx`:
- `ganttOriginalCols`, `TM_GANTT_ORIGINAL_ORDER` 참조, `computeGanttRange`, `GROUP_BY_KEY`, `ganttGroup`, `NUMFMT_BY_KEY` (streamExport로 이관)
- `buildStyledWorkbook` import 및 View 분기 전체 삭제
- View/Re-import 둘 다 `streamXlsxExport`로 처리

`src/lib/task-management/columns.ts`의 `TM_GANTT_ORIGINAL_ORDER` 도 export만 남기고 사용처가 없으면 제거.

## 컬럼 순서 (View 포맷)
기존 원본 xlsx Gantt A..T 순서 대신, 현재 화면 `visibleKeys` 순서 그대로 사용 (SM과 동일 정책). 원본 xlsx 순서 재현 요구가 있으면 별도 확인 후 반영.

## Import 자동계산 강제 재계산

`src/contexts/TaskManagementImportContext.tsx` 및 `src/lib/task-management/parser.ts`:
- 원본 헤더가 위 자동계산 컬럼과 매핑되어도 값을 버리고 `null` 로 upsert
- upsert 완료 후 `rollup.functions.ts`의 재계산 서버 함수 호출을 강제 (이미 존재 여부 확인 후 없으면 추가)
- 관련 admin의 header mapping UI에서 해당 필드는 "자동계산(무시됨)" 뱃지 표시

## 검증

수정 후 다음을 스크립트로 확인:
1. XML 파싱 오류 0
2. 병합 내부 셀 잔여 0
3. `<f>` 태그 0 (수식 완전 제거)
4. `<mergeCells>` 는 상단 헤더 블록에만 존재
5. `fullCalcOnLoad` 미설정

실제 MS Excel 오픈 확인은 사용자 로컬.

## 이번에는 하지 않을 것

- Re-import 포맷 변경 안 함 (이미 문제 없음, 다만 파이프라인 통일을 위해 `streamXlsxExport`로 옮김)
- SM/ABD/Spare Part의 export 로직 변경 안 함
- `defect-management/bulk-actions.ts`의 styled-workbook 사용은 default 테마이므로 그대로 유지