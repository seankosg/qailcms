# ABD Dashboard — Plot/Batch 탭형 필터 연동

## 목표
1. 대시보드 상단에 **2단계 탭형 다중선택 필터** 신설: (1) Plot, (2) Batch No.
2. 필터 값이 **모든 KPI/차트에 실시간 반영**되도록 상태·쿼리 연동.
3. **Approval Trend 차트 폐기** (관련 컴포넌트·서버 함수·RPC 호출 제거).

## UI 변경 (`AbdDashboardPage.tsx`)
- 기존 헤더 우측 `Batch: N selected` Popover 제거.
- 헤더 아래 별도 필터 바 추가 — 2줄 구성:
  - **Plot** 라벨 + 토글 칩(chip) 리스트. `All` + Plot 값들. 다중 토글, 선택 시 primary 강조.
  - **Batch** 라벨 + 토글 칩 리스트. `All` + Batch 값들. 다중 토글. 항목이 많을 경우 가로 스크롤(`overflow-x-auto`), 줄바꿈 허용은 하지 않음 (SM 스타일과 일관).
  - 각 줄 우측에 선택된 항목 개수 및 `Clear` 링크.
- 스타일: 기존 Team 탭(Raw Data)와 동일한 chip 패턴 재사용, `Toggle`/버튼 variant `outline` ↔ `default`.

## Plot/Batch 옵션 소스
- 기존 `abd_items_facets` RPC를 재사용 (이미 `batch_no` 조회 중).
- Plot 옵션: `abd_items_facets(_column: "plot", ...)` 로 새 쿼리 추가.
- Batch 옵션: 기존 방식 유지하되 선택된 Plot에 따라 좁혀지도록 `_plot` 인자 전달.

## 상태·연동
- `AbdDashboardPage`에 `plotFilter: string[]`, `batchFilter: string[]` 상태.
- 하위 카드 컴포넌트(`AbdRow1Kpis`, `AbdRow2Kpis`, `AbdStatusMixDonut`, `AbdJudgmentDonut`, `AbdJudgmentStageBreakdown`, `AbdRow6Attention`, `AbdRow6Crosscut`)에 `plots`, `batchNo` prop을 모두 전달.
  - Row1/Row2/Attention/Crosscut은 이미 `plots` prop 지원.
  - **StatusMix/Judgment/StageBreakdown**은 현재 `batchNo`만 받음 → `plots` prop 추가.
- `openRawData()`가 URL 파라미터에 `plot=` 도 함께 전달하도록 확장.

## 서버 함수 / RPC 확장
- `getAbdDashboardJudgmentMix` (`src/lib/abd/dashboard.functions.ts`) 의 입력 스키마에 `plots: string[]` 추가.
- Supabase RPC `abd_dashboard_judgment_mix` 마이그레이션: `_plots text[] default null` 인자 추가 후 WHERE 절에서 `plot = ANY(_plots)` 조건 적용. (기존 3개 dashboard RPC와 동일 패턴)
- 다른 RPC(`abd_dashboard_row1/row2/attention_lists/crosscut`)는 이미 `_plots` 지원 — 변경 없음.

## Approval Trend 제거
- `AbdDashboardPage.tsx`에서 `<AbdRow4ApprovalTrend />` 렌더 블록 및 관련 grid 삭제, `invalidateQueries(["abd-dash-trend"])` 제거.
- `AbdChartsRows.tsx`에서 `AbdRow4ApprovalTrend` 컴포넌트 삭제, `getAbdDashboardApprovalTrend` import 제거.
- `src/lib/abd/dashboard.functions.ts`에서 `getAbdDashboardApprovalTrend` 서버 함수 삭제.
- DB의 `abd_dashboard_approval_trend` RPC는 그대로 두어(다른 참조 가능) 회귀 위험 최소화. (제거 원하시면 별도 확인)

## 산출물
- `src/components/abd/dashboard/AbdDashboardPage.tsx` — 필터 바, 상태, prop 전파, Approval Trend 제거.
- `src/components/abd/dashboard/AbdChartsRows.tsx` — Approval Trend 컴포넌트 삭제.
- `src/components/abd/dashboard/AbdStatusMixDonut.tsx`, `AbdJudgmentDonut.tsx`, `AbdJudgmentStageBreakdown.tsx` — `plots` prop 추가, queryKey/입력에 반영.
- `src/lib/abd/dashboard.functions.ts` — `getAbdDashboardJudgmentMix` 스키마 확장, `getAbdDashboardApprovalTrend` 삭제.
- Supabase migration — `abd_dashboard_judgment_mix(_batch_no, _plots)` 시그니처 확장.

## 검증
- `tsgo` 타입 체크.
- 프리뷰에서 Plot 다중 선택 → 모든 KPI/차트 숫자 변경 확인.
- Batch 다중 선택 → 마찬가지.
- Plot=C 단독일 때 Batch 옵션 리스트가 좁아지는지 확인.
- Approval Trend 섹션이 화면에서 사라졌는지 확인.
