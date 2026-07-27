## 목표

`AbdProgressPage.tsx` 상단의 KPI 스트립(현재 6개: Cum Plan / Cum Actual / Variance / Done Stages / Progress / Range)을 **Progress 전용 신규 세트**로 교체. 툴바 전체 필터 반영, 카드 클릭 시 Dashboard와 동일 규칙으로 Raw Data 딥링크.

## 새 KPI 카드 세트 (총 6개)

`totalsQ.data` 및 `cellsQ.data` 기반으로 As-of Date(툴바) 시점 집계. Plot/Team/Stage/As-of/Plan Mode 툴바 상태 전체 반영.

| # | 카드 | 값 | 서브 라인 | Tone | 클릭 딥링크 |
|---|---|---|---|---|---|
| 1 | **Progress** | `done / total` (%) | `Δ vs Plan: ±N pp` | ok/warn/danger | — (표시 전용) |
| 2 | **On Track** | Actual ≥ Plan 인 스테이지 건수 | `x% of scope` | ok | Raw Data (status=in_progress) |
| 3 | **Behind Plan** | Plan 대비 미달 스테이지 수 (`plan_upto - actual_upto`, 음수 제외) | `x pp gap` | warn | Raw Data (status=in_progress, delay filter) |
| 4 | **Response Delay** | RS 지연 카운트 (row2 RPC `RS`) | 팀별 breakdown | danger | Raw Data `status=rs_delay` |
| 5 | **Submission Delay** | SB 지연 카운트 | 팀별 breakdown | danger | Raw Data `status=sb_delay` |
| 6 | **Draft Delay** | DS+DF 지연 카운트 합 | 팀별 breakdown | danger | Raw Data `status=ds_delay` |

- 지연 3종(4~6)은 Dashboard의 `abd_dashboard_row2` RPC를 재사용하되, 툴바 Plot/Team 필터를 파라미터로 전달.
- Progress/On Track/Behind Plan은 기존 `getAbdProgressTotals` 결과에서 파생 (Stage 필터 반영).
- 각 카드는 `AbdKpiCard`(`src/components/abd/dashboard/AbdKpiRows.tsx`)를 재사용해 대시보드와 시각적 일관성 유지 (breakdown, tone, hover, stackBar 옵션).

## 클릭 딥링크 규칙 (Dashboard와 동일)

`AbdKpiRows.tsx`의 `buildRawUrl` 헬퍼와 동일 파라미터 스키마 사용:
- `plot`, `tab`(팀), `status`(under_review/rs_delay/sb_delay/ds_delay/in_progress 등)
- `source=progress` 마커 유지
- Stage 필터는 URL `stage=` 로 전달

## 파일 변경

1. **`src/components/abd/progress/AbdProgressPage.tsx`**
   - 하단 로컬 `KpiCard` 컴포넌트 제거.
   - `kpis` useMemo 확장: On Track / Behind / gap 계산 추가.
   - Dashboard row2 RPC 쿼리 추가 (`useServerFn(getAbdDashboardRow2)`) → 지연 3종 카운트.
   - KPI 스트립을 `AbdKpiCard` 6장으로 재구성, `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`.
   - 각 카드 `onClick` → `/closure/abd/raw-data?...` 이동.

2. **`src/components/abd/dashboard/AbdKpiRows.tsx`**
   - `AbdKpiCard` export 확인 (이미 export 되어 있음, 수정 불필요 예상).
   - 딥링크 URL 빌더가 별도 헬퍼면 export, 아니면 Progress 페이지 내부에 동일 로직 복제.

3. **레이아웃**: Toolbar 카드 아래에 KPI 스트립 배치 (현재 위치 유지).

## 검증 (build 모드 진입 후)

- Playwright: `/closure/abd/progress` 접속 → 6개 카드 렌더 확인, 각 카드 클릭 시 Raw Data 배지 숫자와 카드 숫자 일치.
- 툴바에서 Team=MECH, Plot=C 선택 시 카드가 필터 반영해 리렌더 확인.
- Stage 토글 변경 시 Progress/On Track/Behind가 재계산되는지 확인.

## 기술 세부

- 지연 3종은 `abd_dashboard_row2` RPC 재활용 → 신규 RPC 불필요.
- 상태값 매핑(rs_delay/sb_delay/ds_delay)은 이전 턴 ABD 딥링크 정합 작업 결과 그대로 동작 (검증 완료된 파라미터 사용).
- `Range` 카드 삭제(툴바에 이미 노출되어 중복).
