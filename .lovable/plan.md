## 파일 분석 결과 (task-management_view_20260719_0804.xlsx)

파일 구조를 압축 해제하여 XML을 직접 검사했습니다. 파일 자체는 openpyxl과 LibreOffice로는 정상적으로 열립니다. 즉 **치명적 손상은 아니고**, MS Excel의 엄격한 스키마 검증이 `"파일 내용에 문제가 있습니다. 복구할까요?"` 대화상자를 띄우는 유형의 경고입니다.

수집된 파일 사실:
- 시트: `Gantt` (751열 × 330행), `설정` (3열 × 20행)
- 병합 24개: `A1:ABW1`, `A2:ABW2`, `A3:ABW3`, `D4:F4`, 그리고 `A6:A7 ~ T6:T7` (세로 병합 20개)
- 수식 3,322개 (모두 `<v>` 캐시값 없음)
- 조건부 서식 20개 (dxfId 0–19, 정의된 dxfs 20개와 일치)
- `<workbookPr>`에 **`fullCalcOnLoad="1"`** 설정
- `<sheetFormatPr customHeight="1"/>` — `defaultRowHeight` 누락

## 문제의 실제 원인 (우선순위 순)

### 1. 세로 병합 안쪽 셀에 스타일이 찍혀 있음 — 가장 유력한 복구 트리거
`A6:A7` ~ `T6:T7` 세로 병합 20개 각각의 **비-좌상단 셀**(A7~T7)에 `<c r="A7" s="6"/>` 형태로 스타일 6이 지정된 빈 셀이 저장되어 있습니다.

OOXML 스펙상 병합 영역의 비-좌상단 셀은 값·스타일 모두 없어야 하며, Excel은 이 조건 위반을 발견하면 정확히 다음 메시지를 냅니다:
> "제거된 레코드: /xl/worksheets/sheet1.xml 부분의 병합된 셀"

xlsx-js-style이 각 셀에 강제로 스타일을 쓸 때 병합 마스킹을 하지 않아서 발생하는 알려진 부작용입니다.

### 2. `fullCalcOnLoad="1"` + 캐시값 없는 수식 3,322개
Gantt 셀·집계 셀·날짜 헤더 셀 모두 `<f>` 태그만 있고 `<v>` (마지막 계산 결과)가 없습니다. `fullCalcOnLoad="1"`가 켜져 있어 Excel은 열자마자 전체 재계산을 수행합니다.

이때 상위(parent) 행의 롤업 수식들이 자식 행에서 빈 셀을 만나 오류로 흐릅니다:
- `L8-K8+1` → K8, L8이 `""`이면 `#VALUE!`
- `SUMPRODUCT(O9:O11,M9:M11)/SUM(M9:M11)` → `SUM=0`이면 `IFERROR`로 잡히지만, 형변환 단계에서 경고 로그가 생김
- `IF(COUNT(N9:N11)=0,"",MIN(N9:N11))` → 상위행이 `""`를 반환해도 후속 수식은 문자열 연산이 되어 다시 오류

Excel은 이런 대량 재계산 실패를 만나면 위 1번과 같은 "일부 콘텐츠 복구" 다이얼로그를 함께 띄우는 경우가 있습니다.

### 3. `<sheetFormatPr customHeight="1"/>`에 `defaultRowHeight` 누락
스펙상 `customHeight="1"`이면 `defaultRowHeight`가 함께 있어야 합니다. 단독으로는 대개 무시되지만 Strict 모드에서 경고에 기여할 수 있습니다.

## 결론
Gantt 차트 자체(그리기 객체)나 XML 문법 오류가 아닙니다. XLSX에는 실제 Gantt 차트 객체가 없고 조건부 서식으로 색만 칠하는 방식이라 그래픽 개체 손상은 없습니다.

원인은 **파일 생성기(`src/lib/excel/styled-workbook.ts`, `xlsx-js-style` 기반)가 병합 영역의 비-좌상단 셀에도 스타일을 기록**하고, **모든 수식 셀에 캐시된 계산값을 쓰지 않은 상태로 `fullCalcOnLoad`를 켠 것** 두 가지의 조합입니다.

## 제안하는 수정 (승인 시 진행)

`src/components/task-management/raw-data/ExportDialog.tsx` 및 `src/lib/excel/styled-workbook.ts` 에서:

1. **병합 영역 마스킹**: sheetData를 flush하기 전에 merges 목록을 순회하여 비-좌상단 셀 엔트리를 제거. Gantt 뷰에서 A7..T7 등 세로 병합 하단 셀에 스타일이 찍히지 않도록 스킵.
2. **`fullCalcOnLoad="0"`로 변경**: 파일 오픈 시 즉시 재계산을 요구하지 않도록 workbookPr을 조정. Excel이 파일을 연 뒤 사용자가 셀에 진입하면 자동 재계산됨.
3. **캐시값 채우기(선택)**: 날짜 헤더(`U7+1`)와 M열(`L-K+1`) 같은 결정론적 수식은 export 시점에 값도 함께 계산해 `<v>`를 채워 넣으면 재계산 부담과 오류 경고가 사라짐. openpyxl 이후 처리 대신 export 코드에서 미리 계산.
4. **`<sheetFormatPr>`에 `defaultRowHeight="15"` 추가**: `customHeight="1"`을 유지하려면 짝을 맞춤.

수정 후 확인 방법: 실제 MS Excel에서 열어 복구 다이얼로그가 사라지는지 검증(사용자 로컬) + `code--exec`로 xlsx를 다시 풀어 A7..T7에 `<c>` 엔트리가 없는지, `fullCalcOnLoad="0"`인지 확인.

빌드 모드로 전환해 주시면 위 4개 항목을 반영하겠습니다.