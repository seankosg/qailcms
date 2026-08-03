# Room Group별 현황 카드 — 값 연동 생성 및 숨김

## 목표
SM Dashboard의 "Room Group별 현황" 카드 묶음을 매트릭스 열과 동일한 규칙으로, 실제 `room_group` 값과 상단 Room Group 필터바에 연동해 생성·숨김되게 한다.

## 현재 동작 (실측)
- `DeSnagDashboardPage.tsx:198` — 카드 목록을 고정 상수 `ROOM_GROUP_ORDER` 전체로 생성. 실제 데이터에 없는 그룹도 항목이 만들어지고, 상수에 없는 원본 값은 `N/A` 카드로 흡수됨.
- `DeSnagRoomGroupCards.tsx:125` — `stats.issued > 0` 인 카드만 렌더(0건 숨김은 이미 동작).
- 상단 `DeSnagRoomGroupFilterBar`(`DeSnagDashboardPage.tsx:277`)의 선택은 행 필터에만 반영되고 카드 목록 구성에는 직접 연동되지 않음.

## 변경 내용

### 1) 데이터 기반 카드 생성
- 카드 목록을 `matrix.roomGroupTotals` 의 실제 키에서 유도한다.
- 정렬: `ROOM_GROUP_ORDER` 에 있는 열은 상수 순서대로, 상수에 없는 값(정규화 후에도 매핑되지 않는 신규 표기)은 그 뒤에 알파벳 순으로 배치.
- 이로써 새 `room_group` 값이 들어와도 코드 수정 없이 전용 카드가 생성된다.
- LG Podium 통합 카드와 `N/A`(빈 값) 카드 규칙은 현행 유지.

### 2) 필터바 연동 + 숨김
- 상단 Room Group 필터바에서 선택된 그룹이 있으면 그 그룹의 카드만 표시.
- 선택이 없으면(전체) 실적이 있는 카드만 표시.
- 두 조건은 AND 로 적용: 선택되었더라도 Issued 0건이면 숨김.
- 표시할 카드가 하나도 없으면 섹션 전체를 숨기는 현행 동작 유지.

### 3) 안내 문구 보강
- 섹션 헤더 우측 설명에 현재 표시 중인 카드 수 / 전체 그룹 수를 덧붙여 숨김이 일어났음을 사용자가 알 수 있게 한다. (문구만 추가, 레이아웃 변경 없음)

## 기술 세부
- 수정 파일
  - `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx` — `roomGroupEntries` useMemo 를 totals 키 기반 유도로 교체, `appliedRoomGroups` 를 의존성에 추가.
  - `src/components/defect-management/dashboard/DeSnagRoomGroupCards.tsx` — 표시 카운트 문구 추가(가시성 필터 로직은 현행 `issued > 0` 유지).
- `dashboard-shape.ts` 의 집계/정규화 로직과 드릴다운 파라미터 규칙(`roomGroupSourceMap`)은 변경하지 않는다.
- 매트릭스 블록(열 구성·드릴다운)은 손대지 않는다.