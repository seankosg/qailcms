# SM Dashboard — Each Date 토글

매트릭스 각 셀의 숫자를 날짜(dd/mmm)로 대체해 보여주는 토글을 HO Date 토글 오른쪽에 추가한다.

## 동작

- **Each Date = OFF** — 지금과 완전히 동일(건수/% 표시).
- **Each Date = ON**
  - 각 셀(= 행 × Room Group × 스테이지 × 팀)에 그 대상 항목들의 **가장 늦은 계획일**을 `dd/mmm` 으로 표시.
  - 스테이지별 계획일: Rect = 보수 계획일, Pre-Ins = 사전검사 계획일, DAR-Ins = DAR 검사 계획일, Closed = 종결 계획일, H/O = 인계 계획일.
  - **Issued 열은 빈칸(–)** — 스테이지가 아니므로 날짜를 두지 않는다.
  - **완료된 셀**(대상 건수 > 0 이고 잔여 0)은 **가장 늦은 실적일**을 표시하고 **회색 반전**(회색 배경 + 흐린 글자)으로 구분.
  - 값이 없으면 `–`.
  - Column Total · 행 합계 · 빌딩 소계 칸도 같은 규칙으로 접는다(하위 셀들의 최댓값).
- **HO Date 와 상호 배타** — Each Date 를 켜면 HO Date 가 꺼지고, HO Date 를 켜면 Each Date 가 꺼진다.
- 두 토글 상태 모두 지금처럼 주소(URL)에 남아 새로고침·공유 시 유지된다.

## 범위 밖

- 숫자 모드(개수/%/잔여) 탭, 병목·Ready 강조, 드릴다운 동작은 변경하지 않는다. 셀 클릭 시 이동 동작은 Each Date 모드에서도 그대로 유지한다.
- 엑셀 다운로드는 이번에 손대지 않는다(현행 HO Date 열 포함 규칙 유지). 필요하면 별도 요청으로 진행.

## 기술 사항

1. **DB — 신규 RPC** `defect_snag_stage_dates_json(_plan_groups text[], _teams text[], _as_of_date date) RETURNS jsonb`
   - `defect_items_raw` (is_active, plan_group, team, data_date ≤ as-of) 를 기존 `defect_snag_ho_dates_json` 과 동일한 필터·축으로 집계.
   - GROUP BY building, level_name, room_group, room(LIFT CABIN 한정), subcontractor(LIFT CABIN 한정), **team**.
   - 각 그룹에서 `max(planned_rectified_date | planned_pre_inspection_date | planned_dar_inspection_date | planned_closure_date | planned_ho_date)` 와 대응 `max(actual_*)` 10개 값 반환.
   - jsonb 스칼라 반환(RPC 반환 계약 규칙 2항). 기존 RPC는 수정하지 않는다.

2. **`src/lib/defect-management/stage-dates.ts` (신규)**
   - `ho-dates.ts` 의 축 정규화 방식을 그대로 따르되 키에 `stage` 와 `team` 을 추가:
     `c|kind|building|levelDisp|col|stage|team`, 그리고 `r|`, `b|`, `g|`, `k|` 접두 집계 키.
   - planned/actual 각각 최댓값으로 접는 `StageDateMap` 과 `EMPTY_STAGE_DATE_MAP` 제공.

3. **`src/hooks/useSnagStageDates.ts` (신규)** — `useSnagHoDates` 와 동일 형태, `enabled = eachDate`.

4. **`DeSnagDashboardPage.tsx`**
   - `eachDate` 검색 파라미터(0/1) 추가, HO Date 토글 오른쪽에 `Switch` + `Label` 배치.
   - `setEachDate(true)` 시 `hoDate: 0`, `setShowHoDate(true)` 시 `eachDate: 0` 을 같은 navigate 에서 처리.
   - Room Group 필터가 적용된 경우 HO 맵과 동일하게 행을 선필터한 뒤 맵을 만든다.
   - 하단 안내 문구에 Each Date 규칙 한 줄 추가.

5. **`DeSnagMatrixBlock.tsx`**
   - `eachDate`, `stageDates` prop 추가. `TeamCells` 에 동일 prop 전달.
   - `eachDate` 일 때 셀 본문을 `formatHoDate(...)` 결과로 대체(`ho-dates.ts` 의 포맷터 재사용), 정렬은 가운데, 최소 너비 `min-w-[52px]`.
   - 완료 판정은 기존 잔여 계산과 동일한 식(`t.issued > 0 && t.issued - done <= 0`)을 재사용하고, 완료 시 실적일 + 회색 반전 스타일(`bg-muted`, `text-muted-foreground`) 적용. 병목/Ready 배경보다 우선한다.
   - `title` 툴팁에는 기존 건수·비율 문구를 유지하고 계획일/실적일을 덧붙인다.