# SM 대시보드 매트릭스 H/O 스테이지 음영 적용

## 목표
De-Snagging Matrix의 H/O 스테이지에도 Rectified/Closed 스테이지와 동일한 "잔여 0" 음영 하이라이트를 적용한다. 화면과 Excel export 양쪽에 동일하게 반영한다.

## 현재 동작
- `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx` `TeamCells` 함수에서 잔여 모드(`remain`, `remainPct`, `remainDate`)일 때만 음영이 동작한다.
- `rectReady`: 세 팀 모두 `issued - rect <= 0` → 하늘색(`sky-400`) + "Ready for Inspection"
- `closedReady`: 세 팀 모두 `issued - closed <= 0` → 에메랄드(`emerald-400`) + "Ready for Handover"
- H/O 스테이지는 음영 대상에서 제외되어 있다.

## 변경 범위

### 1. 화면: `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx`
- `TeamCells` 내에 `hoReady` 조건 추가.
  - 조건: `isRemainMode && totalIssued > 0 && TEAM_COL_ORDER.every(tk => issued - ho <= 0)`
  - 색상/툴팁: Closed와 동일한 에메랄드 계열(`emerald-400` 30%)에 "Ready for Handover" 툴팁을 그대로 사용. H/O가 Handover의 후속 단계이므로 의미상 동일하게 처리.
- `readyTone` 분기에 `sc.slot === "ho" && hoReady` 케이스 추가.
- 글자 굵게 처리(`font-semibold`)도 Rectified/Closed와 동일하게 적용.

### 2. Excel: `src/lib/defect-management/matrix-excel.ts`
- `writeStats` 내부에서 H/O 슬롯의 잔여 0 여부를 판정하는 로직 추가.
- 화면과 동일한 에메랄드 배경 + 굵은 글씨 스타일을 H/O 잔여 0 셀에 적용.
- `eachDate`/`remainDate` 모드에서도 H/O Date 셀에는 음영을 적용하지 않고 숫자 셀에만 적용(기존 Rect/Closed 규칙과 동일).

## 검증
- `bunx tsgo --noEmit` 타입 검사 통과.
- Playwright로 잔여 모드에서 H/O 열이 모두 0인 셀에 에메랄드 음영이 들어가는지 확인.
- Excel export에서 H/O 잔여 0 셀의 배경색/글씨 굵기가 화면과 일치하는지 샘플 검증.

## 제약
- UI 요소·배치·문구·색상 토큰은 기존 Rect/Closed 음영과 동일하게 사용. H/O 전용 새로운 색상이나 레이블은 추가하지 않는다.
- 효율화 라운드 UI 불변 원칙에 따라, 매트릭스 컬럼 순서·헤더·필터·토글·드릴다운 동작은 변경하지 않는다.
