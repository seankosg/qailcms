# 블록별 현황 — 값 없는 열 숨김

## 목적
SM 대시보드 "블록별 현황" 매트릭스에서, 해당 블록에 실적이 전혀 없는 Room Group 열(Issued = 0)을 자동으로 숨긴다. 현재 일반 블록(Tower/Podium/Basement)은 실적 유무와 무관하게 `ROOM_GROUP_ORDER` 전 열을 항상 표시한다(`dashboard-shape.ts:427`). LG 블록과 LIFT CABIN 블록은 이미 실적 있는 열만 표시하고 있으므로(414~426행), 동일 규칙을 일반 블록에도 적용한다.

## 규칙
- 숨김 판정 기준: 그 블록의 열 합계(`colTotals[열].issued`)가 0이면 숨김.
- 판정 단위는 블록별. 같은 Plot 안에서도 Tower에는 있고 Basement에는 없는 열은 Basement에서만 사라진다.
- 전 열이 0인 블록은 열이 하나도 없는 표가 되지 않도록, 기존 순서 기준 첫 열 1개를 남긴다(LG 블록과 동일한 폴백).
- Row Total / Block Total / Plot Total 값은 변경 없음(숨겨지는 열은 이미 0이므로 합계 불변).
- 엑셀 다운로드는 화면과 동일한 열 구성을 따른다(`matrix-excel.ts`가 `block.columnKeys`를 그대로 사용하므로 자동 반영).
- 상단 Room Group 요약 카드/필터 탭은 이번 변경 대상이 아니다(그대로 유지).

## 기술 상세
- `src/lib/defect-management/dashboard-shape.ts` `buildBlock()`의 `columnKeys` 계산에서 일반 블록 분기를 `[...ROOM_GROUP_ORDER]` 대신 `ROOM_GROUP_ORDER.filter(rg => colTotals[rg].issued > 0)`(빈 결과 시 첫 열 유지)로 변경.
- `DeSnagMatrixBlock.tsx`와 `matrix-excel.ts`는 이미 `block.columnKeys`만 참조하므로 수정 불필요. 렌더 시 `row.cells[열]` 접근은 `emptyRoomGroupStats()`로 전 열이 초기화되어 있어 undefined 위험 없음.
- 검증: Plot A~D 각각에서 화면 열 구성과 각 블록 Row Total 합계가 변경 전과 동일한지, 엑셀 출력 열이 화면과 일치하는지 실측 확인.