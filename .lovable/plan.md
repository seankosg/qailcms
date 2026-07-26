
## 변경 목표
ABD Dashboard Row1의 Total KPI 카드에 (1) 다른 카드들처럼 팀별 breakdown 리스트를 표시하고, (2) 카드 하단에 Approved/UR/DS/NS 4개 포션을 각기 다른 색으로 표현하는 스택 진도율 바를 추가한다. 카드 높이는 그대로 유지한다.

## 수정 파일
- `src/components/abd/dashboard/AbdKpiRows.tsx`
- `src/components/abd/dashboard/AbdDashboardPage.tsx` (변경 없음 — Row1이 내부적으로 처리)

## 상세 구현

### 1) `AbdKpiCard` 컴포넌트 확장
- 새 옵션 prop `stackBar?: Array<{ key: string; label: string; count: number; className: string }>` 추가.
- `stackBar`가 있으면 `CardContent` 하단에 높이 `h-1.5` 스택 바를 렌더링:
  - 각 세그먼트 width = `(count / total) * 100%`, 각 세그먼트에 tone별 배경색 클래스 적용.
  - hover 시 툴팁(title 속성)에 `label count (pct%)` 표시.
- 바 아래 한 줄의 legend(범례) — `flex gap-2 text-[10px]` — 로 색상 dot + `Label pct%` 표시 (한 줄, truncate).
- 카드 높이 유지를 위해 다른 카드와 padding/spacing 동일하게 처리 (breakdown 컬럼 유무는 이미 이 스택 바가 채워서 균형).

### 2) `AbdRow1Kpis` Total 카드 호출부 수정
- Total 카드에 다음 두 가지 추가:
  - `breakdown`: `byTeam.get("TOTAL")` — 다른 카드와 동일하게 팀별 카운트 표시, 클릭 시 `onOpenRaw({ team: b.team })`.
  - `stackBar`: 순서 = Approved(emerald) → UR(blue) → DS(amber) → NS(red). 값은 `totals.get(key) ?? 0`, className은 아래 팔레트 사용.
- 색상 팔레트(각 카드 숫자 톤과 정합):
  - Approved: `bg-emerald-500`
  - UR: `bg-blue-500`
  - DS: `bg-amber-500`
  - NS: `bg-red-500`

### 3) 데이터 소스 확인 사항
- `pivotRows`는 `bucket = "TOTAL"`이며 `team != null`인 행을 이미 `byTeam.get("TOTAL")`로 집계한다. RPC `abd_dashboard_row1`이 TOTAL bucket에 대해 팀별 행을 반환하는지 확인 후 그대로 사용. (반환하지 않는다면 4개 스테이지의 팀별 합을 클라이언트에서 합산하여 대체.)

## 미확인 항목 확인 필요
빌드 모드 진입 후 첫 단계로 `abd_dashboard_row1` RPC가 TOTAL bucket의 팀별 행(team!=null)을 반환하는지 실제 응답을 확인. 반환하지 않으면 클라이언트에서 4개 스테이지 팀별 카운트를 합산하는 fallback으로 처리한다.
