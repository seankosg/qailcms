# De-Snag Matrix — LG 블록 Room Group 실제 값 표시

## 배경

LG(Lower Ground) 블록은 지금 열이 `Podium 1 ~ Podium 5` 고정 목록으로만 그려집니다. 실제 Raw Data의 LG 행에는 Podium 계열 외에도 BOH, CORRIDOR, CARPARK/ RAMP, STAIRCASE, FOH, LIFT 값이 존재하며(전체 기준 10종, Plot C 기준 4종), 이 값들은 집계에는 들어가지만 화면 열로는 보이지 않아 행 합계와 열 합이 어긋나 보입니다. 데이터에 없는 Podium 5는 반대로 자리만 차지합니다.

## 바꿀 내용

1. LG 블록의 열을 **데이터에 실제로 존재하는 Room Group 값 전부**로 동적 구성합니다. 건수가 0인 값은 열을 만들지 않습니다.
2. 열 이름은 **정규화된 표기**를 사용합니다(예: `CARPARK / RAMP`, `LIFT`). 기존 다른 블록과 표기가 같아집니다.
3. 열 순서는 기존 Room Group 표준 순서를 따르고, 표준 목록에 없는 값(Podium 1~4 등)은 뒤쪽에 이름 순으로 붙입니다.
4. 상단 **Room Group 카드**의 `LG Podium` 통합 카드를 없애고, LG의 각 Room Group을 다른 값들과 동일하게 개별 카드로 표시합니다.
5. **Room Group 필터 버튼**의 `LG Podium` 단일 토글도 제거하고 실제 값별 토글로 분리합니다.
6. Excel 다운로드는 화면과 동일한 열 구성·라벨로 내려가도록 맞춥니다(잔여/Each Date/잔여+Date 토글 동작은 그대로).

## 유지되는 것

- 잔여·%·HO Date·Each Date·잔여+Date 토글, Overdue 빨간 셀 규칙, 팀·Plot·Level 필터, 드릴다운 이동 규칙, 다른 블록(Tower/Podium/BSM/LIFT CABIN/VIP)의 열 구성은 변경하지 않습니다.
- 집계 수치 자체는 바뀌지 않습니다. 지금까지 숨어 있던 값이 열로 드러날 뿐이며, 블록 합계는 동일합니다.

## 기술 메모

- `src/lib/defect-management/dashboard-shape.ts`
  - `buildMatrix`에서 `lg` 블록을 동적 열 블록으로 전환(`dynamicCells = true` 경로 사용, 셀 키 = `normalizeRoomGroup(room_group)`).
  - `columnKeys` 산출을 `LG_ROOM_GROUPS` 고정 필터에서 "존재 값 + `ROOM_GROUP_ORDER` 우선 정렬 + 잔여 이름 순" 규칙으로 교체.
  - `LG_ROOM_GROUPS` / `isLgRoomGroup` 은 카드·필터 통합 용도로만 쓰이므로 사용처 제거 후 정리(`normalizeRoomGroup`의 `Podium N` 매핑은 유지).
- `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx`: `__LG_PODIUM__` 통합 카드 블록과 `roomGroupTotalCount`의 LG 보정 제거, `isLgRoomGroup` 제외 필터 제거.
- `src/components/defect-management/dashboard/DeSnagRoomGroupFilterBar.tsx`: `LG_TOKEN` 토글 제거, 토글 목록을 데이터 존재 값 기준으로 생성.
- `src/lib/defect-management/matrix-excel.ts`: LG 블록 열 헤더가 `columnKeys`를 그대로 따르는지 확인·보정.
- 검증: `bunx tsgo --noEmit`, 관련 vitest, Playwright로 Plot 전체/Plot C에서 LG 열 구성(10종 / 4종)과 행 합계 일치 확인.
