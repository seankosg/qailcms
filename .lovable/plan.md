## 목표
현재 엑셀 내보내기의 SHAW 스타일 헤더 블록(타이틀 배너, 메타 정보, 컬럼 헤더, 프리즈, 색상, 폰트, 행 높이 등)은 **그대로 유지**하고, **셀 병합(mergeCells / !merges)만 제거**한다.

## 배경
현재 병합이 발생하는 위치는 5곳이며, 모두 "타이틀 1행 + 메타 5행"을 A열~마지막 컬럼까지 가로로 합치는 용도.
- `src/lib/excel/styled-workbook.ts` (L201–205, L281): 타이틀 + 메타 병합
- `src/lib/excel/stream-export.ts` (L124, L140): 타이틀 + 메타 병합
- `src/components/defect-management/raw-data/ExportDialog.tsx` (L276, L291): SM 커스텀 스트림 export
- `src/components/import-log/task-management/exportTmImportRecord.ts` (L49, L67, L106): TM 임포트 기록(타이틀/섹션 헤더 병합)
- `src/lib/abd/parser.ts` (L238–239): **읽기 전용**(임포트 시 원본 병합 해제) — 대상 아님, 유지.

## 변경 방침
셀 병합만 제거하고, 병합에 의존하던 시각 요소는 아래 원칙으로 보완한다.

1. **병합 제거**
   - `ws["!merges"] = merges;` 및 `ws.mergeCells(...)` 호출 전부 삭제.
2. **타이틀/메타 배경색 유지**
   - 병합 없이도 배너처럼 보이도록, 타이틀·메타 행의 **모든 컬럼 셀에 동일한 fill/폰트/정렬을 적용**한다.
   - 값은 A열에만 넣고 나머지 컬럼은 빈 문자열 + 동일 스타일(빈 스트라이프처럼 보이게).
3. **행 높이·프리즈·컬럼 폭·데이터 스타일**은 기존 값 그대로 유지.
4. **정렬**: 타이틀/메타의 `horizontal: "left"` 유지 — 병합이 없어졌으므로 A열에서 텍스트가 시작되어 오른쪽으로 흐르는 시각효과가 동일하게 유지됨(엑셀 기본: overflow into empty adjacent cells).
5. **경계선**: 타이틀/메타 행에는 기존과 동일하게 border 미적용(현 스타일 유지).

## 구현 단계

### 1) `src/lib/excel/styled-workbook.ts`
- `merges` 배열 및 `push` 호출 2건 삭제.
- 타이틀 행: `setCell(ws, 0, 0, title, STYLE_TITLE)` 뒤에 **`for c in 1..colCount-1` 루프로 빈 값 + `STYLE_TITLE` 적용**.
- 메타 행: 각 메타 행마다 A열 이외에도 빈 값 + `STYLE_META_LABEL`/`STYLE_META_VALUE` 적용.
- `ws["!merges"] = merges;` 라인 삭제.

### 2) `src/lib/excel/stream-export.ts`
- `ws.mergeCells(1, 1, 1, colCount)` 삭제 → 타이틀 셀 스타일을 1..colCount 전체에 적용.
- `ws.mergeCells(r, 1, r, colCount)` 삭제 → 각 메타 행 2..6도 전 컬럼에 동일 스타일 적용.

### 3) `src/components/defect-management/raw-data/ExportDialog.tsx`
- 위 (2)와 동일 방식으로 타이틀/메타 병합 제거 + 컬럼별 스타일 적용.

### 4) `src/components/import-log/task-management/exportTmImportRecord.ts`
- 타이틀 병합(L49) 및 섹션 헤더 병합(L67, L106) 제거.
- 해당 행 전 컬럼에 동일 스타일(폰트/색) 적용해 기존 디자인과 유사하게 유지.

## 회귀 방지
- ABD 임포트 파서(`src/lib/abd/parser.ts`)의 `ws["!merges"]` 읽기 로직은 **변경하지 않음** (원본 파일 병합 해제용).
- 데이터 영역(컬럼 헤더 이하)에는 병합이 없었으므로 영향 없음.

## 검증
- SM/TM/ABD/DMR/Spare export를 각 1회 실행해 다운로드한 파일을 열고 확인:
  - 타이틀/메타 영역이 시각적으로 이전과 동일해 보이는지.
  - 병합 셀이 없는지(엑셀에서 개별 셀 선택 가능한지).
  - 컬럼 폭·프리즈·헤더 색상·데이터 서식이 기존과 동일한지.

## 미변경 사항
- 파일명 규칙, 컬럼 구성, 시트명, 데이터 서식(날짜/숫자 포맷), 프리즈, 배경/폰트 색상, 행 높이.
