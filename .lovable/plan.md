# SM 대시보드 매트릭스 — HO Date 열 추가

## 무엇을 만드나

블록별 매트릭스의 각 Room Group 그룹에서 HO 열 오른쪽에 **HO Date** 열을 하나 추가한다. 값은 그 셀(빌딩 · 층 · Room Group)에 속한 항목들의 `planned_ho_date` 중 **가장 늦은 날짜**를 `dd/mmm` 형식(예: `23/Aug`)으로 표시한다.

표의 맨 오른쪽 Row Total 그룹 끝에는 **Level HO** 열을 둔다. 값은 그 행(층) 전체에서 가장 늦은 HO Date. Row Total의 HO 열 자체에는 날짜를 표시하지 않는다.

이 열들은 기본적으로 **꺼져 있고**, 엑셀 다운로드 버튼 왼쪽의 **HO Date 토글 스위치**로 켜고 끈다. 켜면 엑셀 다운로드에도 동일하게 두 열이 포함된다.

값이 없는 셀은 `–` 로 표시한다.

## 동작 규칙

- 날짜 산출: `MAX(planned_ho_date)`
- 필터 연동: 현재 Plot · Team · Room Group 필터와 as-of 기준일을 매트릭스 수치와 동일하게 적용
- Column Total 행: 해당 열(Room Group) 전체의 최댓값 표시, Level HO 자리에는 블록 전체 최댓값
- Building 소계 행(Podium): 해당 빌딩 범위 최댓값
- LIFT CABIN 블록은 세로축이 room, 가로축이 subcontractor 이므로 같은 축 기준으로 집계

## 기술 세부

1. **DB** — 신규 RPC `defect_snag_ho_dates_json(_plan_groups, _teams, _as_of_date)` 를 추가한다. 매트릭스 RPC(`defect_snag_dashboard_matrix_json`)와 **동일한 GROUP BY 축**(building, level_name, room_group, room, subcontractor)으로 `max(planned_ho_date)` 만 반환하는 jsonb 스칼라. 기존 매트릭스 RPC의 시그니처는 건드리지 않는다(오버로드 충돌 회피).
2. **훅** — `src/hooks/useSnagHoDates.ts` 신설. `useSnagDashboardMatrix` 와 같은 키 구성으로 조회하고, 토글이 켜진 경우에만 `enabled`.
3. **조립** — `src/lib/defect-management/dashboard-shape.ts` 에 `HoDateMap` 타입과 셀/행/열/블록 단위 최댓값 조회 헬퍼를 추가. 기존 `Stats` 구조는 변경하지 않는다.
4. **표** — `DeSnagMatrixBlock.tsx` 에 `showHoDate`, `hoDates` prop 추가. `TeamCells` 뒤에 조건부 `<td>` 1개(그룹당), Row Total 그룹 뒤에 Level HO `<td>` 1개. 3단 헤더에도 동일 위치에 셀 추가(Tier1 colSpan +1, Tier2 "HO Date" rowSpan 2).
5. **토글** — `DeSnagDashboardPage.tsx` 의 엑셀 버튼 왼쪽에 shadcn `Switch` + "HO Date" 라벨. 상태는 URL 검색 파라미터 `hoDate=0|1`(기본 0)로 유지, 라우트 `dashboard.tsx` 의 `searchSchema` 에 추가.
6. **엑셀** — `matrix-excel.ts` 에 `showHoDate` 옵션과 `hoDates` 를 넘겨 화면과 같은 위치·라벨로 열 삽입. 텍스트(`dd/mmm`)로 기록하고 열 너비를 지정.

## 검증

- 토글 OFF 시 화면·엑셀 열 구성이 현재와 **완전히 동일**함을 확인
- 임의 Plot C 블록에서 한 셀의 표시값이 원본 데이터 `max(planned_ho_date)` 와 일치하는지 실측 대조
- Level HO 가 같은 행의 Room Group HO Date 최댓값과 일치하는지 확인
