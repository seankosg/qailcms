# SM Progress: Room Group Group-By 추가

## 목표
SM Progress 매트릭스의 Group By 토글 목록에 **Room Group**을 추가하여, 사용자가 선택 시 좌측 컬럼에 Room Group(LDK, MBR, Kitchen 등) 단위 행이 나타나도록 한다. 상단 Room Group 탭필터와 자연스럽게 연동되어, 필터로 선택된 Room Group만 행으로 표시된다.

## 변경 범위 (frontend + RPC)

### 1) `src/lib/defect-management/progress-utils.ts`
- `GroupBy` 유니온에 `"room_group"` 추가.
- `ALL_GROUP_BY` 배열 선두에 `"room_group"` 삽입(사용 빈도 고려).
- `GROUP_LABELS["room_group"] = "Room Group"`.
- `GROUP_QUERY_PARAM["room_group"] = "roomGroup"` — 셀 클릭 시 Raw Data 이동 파라미터.

### 2) `src/components/defect-management/progress/SnagProgressPage.tsx`
- 별도 UI 변경 없음. `ALL_GROUP_BY`가 확장되면 기존 토글 렌더 루프가 자동으로 "Room Group" 버튼을 추가.
- `handleCellClick`은 `groupKeyToRawParams`로 처리되므로 자동 반영.

### 3) `src/lib/defect-management/progress.functions.ts` + RPC (`defect_snag_progress_cells`, `defect_snag_progress_totals`)
- 서버 함수의 `groupBy` 파라미터 화이트리스트에 `room_group` 추가.
- Postgres RPC의 그룹키(gk) CASE 분기에 `WHEN 'room_group' THEN COALESCE(room_group,'')` 추가. (기존 인라인 CASE 방식 그대로 유지, LATERAL 사용 안 함 — 성능 유지)

### 4) Room Group 탭필터와의 상호작용
- 기존 `roomGroups` 필터(WHERE 절)는 **행 필터**로 계속 작동. 여기서 `room_group`을 group-by로 추가하면:
  - 필터가 비어 있으면 → 모든 Room Group이 행으로 나열.
  - 필터가 [LDK, MBR]이면 → 두 행만 나타남.
- 셀 클릭 시 Raw Data로 이동할 때 `roomGroup=<값>` 파라미터가 전달되어 상세 필터 유지.

## 기술 상세
- `handleCellClick`은 페이지 상단의 `roomGroups` 파라미터도 함께 넘기고 있어, group-by 로 사용될 때는 groupKeyRaw의 값이 덮어써 정확한 단일 Room Group으로 좁혀진다(기존 `groupKeyToRawParams` 동작). 별도 처리 불필요.
- Task Management/ABD 도메인은 변경 없음 (SM 도메인 국한).

## 마이그레이션
`defect_snag_progress_cells`, `defect_snag_progress_totals` 두 RPC의 gk CASE에 room_group 분기 한 줄씩 추가하는 `CREATE OR REPLACE FUNCTION` 마이그레이션 1건.
