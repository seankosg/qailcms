## 목표

현재 SM 대시보드는 `LANDSCAPE` 와 `FACADE` 를 하나의 `FACADE` 열/카드로 병합해 집계한다. 이를 분리해 **Landscape 1장, Facade 1장** 의 독립 Room Group 카드로 만들고, 매트릭스 열·필터 칩·엑셀 출력까지 동일하게 분리한다.

## 현재 상태 (실측)

- `src/lib/defect-management/dashboard-shape.ts:101` — `if (s === "LANDSCAPE" || s === "FACADE") return "FACADE";` 병합 지점(단일 원인)
- `src/lib/defect-management/dashboard-shape.ts:67-78` — `ROOM_GROUP_ORDER` 에 `FACADE` 만 존재, `LANDSCAPE` 없음
- `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx:151, 202` — 드릴다운 파라미터를 `"FACADE,LANDSCAPE"` 로 합쳐 전달
- `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx:223, 315` — 셀/열 헤더 드릴다운도 `"FACADE,LANDSCAPE"` 전달
- 필터 칩(`DeSnagRoomGroupFilterBar.tsx:41`)과 엑셀(`matrix-excel.ts`)은 `ROOM_GROUP_ORDER` / 블록 `cols` 를 그대로 순회하므로 상수 변경만으로 자동 반영

## 변경 내용

### 1. `dashboard-shape.ts`
- `ROOM_GROUP_ORDER` 에 `"LANDSCAPE"` 추가 — 순서는 `... CORRIDOR, FACADE, LANDSCAPE, N/A` (Facade 바로 뒤)
- `normalizeRoomGroup` 의 병합 분기 제거 → `LANDSCAPE` 는 `LANDSCAPE`, `FACADE` 는 `FACADE` 로 각각 반환. 기존 일반 매칭 루프가 두 값을 모두 처리하므로 특수 분기 자체를 삭제

### 2. `DeSnagDashboardPage.tsx`
- `roomGroupParam()` 의 `FACADE → "FACADE,LANDSCAPE"` 분기 제거 (자기 값 그대로 전달)
- `roomGroupEntries` 의 `param` 계산에서 동일 분기 제거 → Landscape 카드는 `roomGroup=LANDSCAPE`, Facade 카드는 `roomGroup=FACADE`
- 카드는 기존 로직대로 `issued > 0` 인 그룹만 노출되므로 데이터가 있으면 자동으로 2장으로 표시

### 3. `DeSnagMatrixBlock.tsx`
- 223행·315행의 `"FACADE,LANDSCAPE"` 병합 파라미터를 각 열 키 그대로 전달하도록 수정

### 4. 필터 바 / 엑셀
- 코드 변경 없음. `ROOM_GROUP_ORDER` 확장에 따라 필터 칩에 `LANDSCAPE` 가 추가되고, 엑셀 매트릭스도 열이 하나 늘어난 상태로 그대로 출력됨. 실제 렌더 결과는 시행 후 확인해 보고

## 영향 / 주의

- 매트릭스 일반 블록의 열이 10개 → 11개로 늘어난다(가로 폭 증가). 이는 "카드+열+필터+엑셀 전부 분리" 승인 범위 내
- LG 블록(Podium 축)은 영향 없음
- 기존 URL 딥링크 `roomGroup=FACADE,LANDSCAPE` 는 Raw Data 필터에서 여전히 두 값 OR 로 해석되므로 깨지지 않음

## 검증

- 대시보드에서 Landscape / Facade 카드 각 1장 노출 및 Issued 합이 기존 병합 카드 값과 일치하는지 대조
- 각 카드 클릭 → Raw Data 건수가 카드 숫자와 일치하는지 확인
- 매트릭스 열 헤더/셀 드릴다운, 필터 칩, 엑셀 다운로드 열 구성 확인
