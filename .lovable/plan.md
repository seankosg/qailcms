# ABD Dashboard 지연 KPI — Total Delay 팀별, 라벨 개편

## 변경 (`src/components/abd/dashboard/AbdKpiRows.tsx`)
`AbdRow2Kpis`:
- **Total Delay 카드에 팀별 breakdown 추가.** RS/SB/DS/NoPlan 4개 버킷의 `byTeam` 배열을 팀별로 합산 → `sortByTeamOrder` 정렬 후 `breakdown` prop으로 전달. 팀 클릭 시 `openRaw({ status_group: "delayed", team: b.team })`.
- **라벨 변경**:
  - `RS Delay` → `Response Delay`
  - `SB Delay` → `Submission Delay`
  - `DS Delay` → `Draft Start Delay`
  - `No Plan`, `Total Delay` 유지.
- 내부 key(`RS_DELAY`/`SB_DELAY`/`DS_DELAY`/`NO_PLAN`)와 `status_group` 파라미터는 그대로 (RPC/URL 호환 유지).

다른 파일·서버함수·RPC 변경 없음.

## 검증
- `tsgo` 타입 체크.
- 프리뷰에서 Total Delay 카드 우측에 MECH·ELEC 팀별 카운트 표시, 4개 카드 라벨 갱신 확인.
