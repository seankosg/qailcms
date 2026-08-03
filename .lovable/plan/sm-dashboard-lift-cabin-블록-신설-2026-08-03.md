# SM Dashboard — LIFT CABIN 블록 신설

Basement(BSM) 블록 아래에 LIFT CABIN 전용 매트릭스 블록을 추가한다. 세로축은 `room`, 가로축은 3단(Subcontractor > Issued/Rect/Closed > Elec·Mech·Arch) 구조로 타 블록과 동일한 셀·색상·드릴다운 규칙을 따른다.

## 현재 상태 (실측)

- `dashboard-shape.ts:149-162` `classifyBuilding()` 에 `LIFT CABIN` 분기 없음 → 전량 `Others`(podium 블록) 낙착
- `defect_items_raw` 실측: `building = 'LIFT CABIN'` **1,004건** / room 71종 / subcontractor 6종 / team 2종
  - 플롯별: Plot C 238(room 19) · Plot D 165(13) · Tower 3 267(17) · Tower 4 334(27)
  - Subcontractor×Team: TKE·ELEC 522 / 미지정·ELEC 240 / Direct·ARCH 130 / 미지정·ARCH 46 / CMTC·ARCH 40 / QCTC·ARCH 22 / ELEC·ELEC 4
- `defect_snag_dashboard_matrix_json` 은 `plan_group·building·level_name·room_group·team·status_raw` 만 GROUP BY → `room`·`subcontractor_name` 축이 없음
- `matrix-excel.ts:80` `groupColsFor()` 는 `block.columnKeys` 만 순회 → 블록 형태만 맞추면 엑셀은 자동 반영
- `DefectRawDataPage.tsx:284-305` `URL_MAP` 에 `subcontractor → subcontractor_name` 은 있으나 **`room` 파라미터 없음**

## 확정 사양 (질의 응답)

- 3단 최하단 = 팀 **3열 고정**(Elec·Mech·Arch). LIFT CABIN 은 Mech 실적 0이라 항상 0 표시
- 상단 Subcontractor 열 = **실적 있는 값만 동적** + `N/A`(미지정) + `Row Total`
- Room 행 정렬 = **자연 정렬**(접두어 그룹 → 숫자 오름차순). 예: `PL 01 … PL 09 < PL 10`, `P-PL 04 < P-PL 12`, `T-SL 02 …`

## 변경 내용

### 1. 집계 RPC — `defect_snag_dashboard_matrix_json`
- 반환 항목에 `room`, `subcontractor` 두 필드 추가. 단 **카디널리티 폭증 방지**를 위해 LIFT CABIN 행에서만 값을 채운다:
  `CASE WHEN upper(trim(building)) = 'LIFT CABIN' THEN room END`, subcontractor 동일
- 파라미터 시그니처는 불변(신규 인자 없음) → 구 시그니처 DROP 불필요
- `rect_cnt`/`closed_cnt` 산출식(as-of 정본)은 그대로 유지

### 2. `dashboard-shape.ts`
- `MatrixRawRow` 에 `room`, `subcontractor` 추가
- `classifyBuilding()` 에 `^LIFT\s*CABIN$/i → { kind: "liftcabin", label: "LIFT CABIN" }` 추가. `BlockKind`/`BlockKey` 에 `liftcabin` 추가
- `buildMatrix()` 분기: `bld.kind === "liftcabin"` 이면 **level 판정보다 우선**해 lift 블록으로 보낸다(지하층 강제 분류에 흡수되지 않도록 LG 판정과 같은 위치에 배치)
- 블록 셀 축을 문자열 키로 일반화: 기존 `Record<RoomGroupCol, Stats>` → `Record<string, Stats>` 로 완화하고, lift 블록은 열 키 = subcontractor 라벨(미지정은 `N/A`), 행 키 = `room`(빈 값은 `N/A`)
- `MatrixBlock` 에 축 라벨 메타 추가: `rowAxis: { primary: string; secondary: string }`(일반 = Building/Level, lift = Block/Room), `colAxisLabel`(일반 = Room Group, lift = Subcontractor)
- lift 블록 행 정렬용 자연 정렬 비교 함수 `compareRoomNatural(a, b)` 신설(접두어 문자열 대소 → 숫자 대소)
- 블록 순서: tower → podium → lg → basement → **liftcabin**

### 3. `DeSnagMatrixBlock.tsx`
- 1단 헤더 좌측 고정 헤더 텍스트를 `block.rowAxis` 에서 읽도록 변경(하드코딩 "Building"/"Level" 제거)
- 열 헤더 드릴다운: lift 블록이면 `roomGroup` 대신 `subcontractor` 파라미터(미지정 열은 `__EMPTY__`)
- 셀 드릴다운 `goCell()`: lift 블록이면 `building=LIFT CABIN`, `room=<행 값>`, `subcontractor=<열 값>`, `team`, `dateField` 조합. `level` 파라미터는 걸지 않는다(행 라벨이 level_name 이 아님)
- Issued/Rect/Closed × 팀 9열, 병목 강조, Ready 하이라이트, 개수/%/잔여 토글은 기존 `TeamCells` 를 그대로 재사용

### 4. 드릴다운 파라미터
- `raw-data.tsx` 검색 스키마에 `room: z.string().optional()` 추가
- `DefectRawDataPage.tsx` `URL_MAP` 에 `room: "room"` 추가(→ `DRILLDOWN_PARAMS` 자동 포함)
- 카드 집계와 동일한 대소문자 무시 규칙을 위해 `defect_items_search` 의 `room`·`subcontractor_name` 필터를 `lower()` 양변 비교로 맞춘다(현행 `room_group` 과 동일)

### 5. 엑셀 / 필터 바
- `matrix-excel.ts` 는 `columnKeys` 순회 구조라 구조 변경 없음. 좌측 축 머리글 2칸 라벨만 `block.rowAxis` 에서 읽도록 대응
- Room Group 필터 칩·카드에는 LIFT CABIN 을 노출하지 않는다(Room Group 축이 아니라 Building 축이므로)

## 영향 / 주의

- LIFT CABIN 1,004건이 기존 `Others`(Podium 블록)에서 빠져 신규 블록으로 이동한다 → Podium 블록 합계가 감소하고 Plot 총계는 불변. 요청 범위 내 의도된 변화
- 상단 Room Group 카드 집계는 `room_group` 기준이므로 영향 없음
- 열 수는 (실적 있는 subcontractor 수 + N/A + Row Total) × 9. 플롯 필터 결과에 따라 최대 5~6그룹 수준

## 검증

- 블록 합계 = `building='LIFT CABIN'` 모집단(Plot C 238 / D 165 / Tower3 267 / Tower4 334)과 일치하는지 검산
- 임의 셀 클릭 → Raw Data 건수가 셀 숫자와 일치하는지 3건 표본 대조
- 열 헤더·행 헤더·블록 전체 보기 드릴다운 각각 확인
- 엑셀 다운로드에 LIFT CABIN 블록이 축 라벨과 함께 출력되는지 확인