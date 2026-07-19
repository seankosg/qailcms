## 목표
SHAW의 `DefectDashboardPage` S-Curve 패널과 동일한 시각화(Bar=일일 증분, Line=누적)를 SM Progress / ABD Progress 페이지에 이식. 기존 매트릭스와 신규 S-Curve 모두 접기 가능한 카드로 재구성. 상단 툴바 필터(plot/teams/roomGroups·round/stageView/range/bucket/planMode/asofMode)를 그대로 재사용.

## 1. 데이터 계층
- SM: `src/lib/defect-management/progress-utils.ts` — 신규 `buildSCurveSeries(cells, stages, buckets, planMode, today)` 추가.
  - 입력: 기존 `getSnagProgressCells` 결과(스테이지×버킷 plan/actual 카운트).
  - 출력: `{ buckets: string[]; bucketLabels: string[]; todayIndex: number; series: Record<Stage, { dailyPlan[], dailyActual[], cumPlan[], cumActual[] }> }`.
  - `planMode='remaining'`일 때 SHAW 로직 동일: 완료된 항목의 plan은 actual 버킷으로 이동.
- ABD: `src/lib/abd/progress-utils.ts` — 동일 시그니처의 `buildSCurveSeries` 추가. 단, `round==='all'`일 때 각 라운드(R1/R2/R3)를 스테이지×라운드 조합의 별도 시리즈로 확장.
  - Latest Status='A' 항목은 스테이지/라운드 상관없이 Approval로 간주하는 기존 로직 유지 → RPC 결과에 이미 반영되어 있으므로 카운트만 이용.

## 2. RPC/서버 함수
- 기존 `abd_progress_cells` / `defect_snag_progress_cells` RPC 결과를 그대로 재사용. 신규 RPC 없음.
- S-Curve 범위는 상단 툴바의 `range` + `hidePast` 값으로 결정 (matrix와 동일 범위).

## 3. UI — SM Progress (`SnagProgressPage.tsx`)
- 매트릭스와 S-Curve 두 개의 `<Collapsible>` 카드로 분리:
  - Card A: **Schedule Matrix** (기존 `SnagScheduleMatrix`).
  - Card B: **Plan vs Actual — S-Curve** (신규 `SnagPlanVsActualCard`).
- 각 카드 헤더에 `ChevronDown/Right` + 제목. 접힘 상태는 URL search param(`matrixOpen`, `scurveOpen`)로 유지.
- 카드 내부 컨트롤 없음(툴바 값만 사용). 우측 상단에 Export(엑셀) 버튼만 노출.

## 4. UI — ABD Progress (`AbdProgressPage.tsx`)
- SM과 동일 구조. `round==='all'`이면 R1/R2/R3 × 선택된 stage들의 시리즈를 모두 렌더 (색상: R1=blue tone, R2=green tone, R3=amber tone × 스테이지별 채도 조합).
- 단일 라운드 선택 시 SHAW와 동일한 스테이지별 색 매핑.

## 5. 신규 컴포넌트
- `src/components/defect-management/progress/SnagPlanVsActualCard.tsx`
- `src/components/abd/progress/AbdPlanVsActualCard.tsx`
- 공통 로직은 `src/components/*/progress/PlanVsActualChart.tsx` 프리젠테이션 컴포넌트에 두고, 각 도메인 카드가 시리즈/색상 config만 주입.

### 차트 구성 (SHAW 동일)
- `recharts` `ComposedChart` + `ChartContainer` (기존 `@/components/ui/chart` 사용).
- Left Y축 = 누적, Right Y축 = 일일. `ReferenceLine x=todayLabel`.
- 각 스테이지(SM: start/rectified/closure, ABD: draft/submission/dar):
  - Bar (right axis, stacked per stage): `dailyActual`(진한 채도) + `futurePlan`(옅은 채도).
  - Line (left axis): `cumPlanned`(dashed) + `cumActual`(solid).
- Legend, Tooltip, 색상 배열은 SHAW `DefectDashboardPage` L607–L631 스킴을 그대로 채택.

## 6. Export (선택 — 이번 스코프 유지)
- Card B 우측 상단 Export 버튼 → SHAW `scurve-excel-export.ts` 참고하여 도메인별 간단 시트(Meta + Data) 저장. 챠트 이미지 캡처는 다음 반복으로 미룸.

## 7. 상태/라우팅
- `src/routes/_authenticated/closure/snag-management/progress.tsx` / `.../closure/abd/progress.tsx` 의 `search` 스키마에 `matrixOpen`, `scurveOpen` (boolean 0/1) 추가. 기본값: matrix=1, scurve=1.

## 기술 참고 (SHAW 소스 인용)
- `SHAW/src/pages/DefectDashboardPage.tsx` L380–L451, L530–L633 → S-Curve 카드 마크업/Export 호출부.
- `SHAW/src/lib/defect-dashboard-utils.ts` `buildDefectSCurve` → 버킷화 + Plan(remaining) 이동 로직.
- `SHAW/src/lib/scurve-excel-export.ts` → Excel export 스킴.

## 변경 파일 요약
```text
수정: src/lib/defect-management/progress-utils.ts   (+buildSCurveSeries)
수정: src/lib/abd/progress-utils.ts                 (+buildSCurveSeries)
수정: src/components/defect-management/progress/SnagProgressPage.tsx
수정: src/components/abd/progress/AbdProgressPage.tsx
추가: src/components/defect-management/progress/SnagPlanVsActualCard.tsx
추가: src/components/abd/progress/AbdPlanVsActualCard.tsx
추가: src/components/*/progress/PlanVsActualChart.tsx (공용 presentational)
수정: src/routes/_authenticated/closure/snag-management/progress.tsx (search schema)
수정: src/routes/_authenticated/closure/abd/progress.tsx           (search schema)
```

## 스코프 제외
- S-Curve 전용 Group by / 별도 범위·버킷 컨트롤 (툴바 값만 사용).
- 차트 이미지 캡처를 포함한 고급 Excel export (텍스트 시트만 제공).
