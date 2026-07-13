# De-Snagging Dashboard — 최종 계획 (프롬프트 재정합)

## 결정된 사항
- 매트릭스 대시보드 단일 뷰 유지 (SHAW의 KPI 카드 세트는 추가하지 않음).
- 셀·헤더 드릴다운은 SHAW `goRaw` URL 규약을 재사용.
- Rectified 셀 클릭 시 `status=Rectified` 우선.
- raw-data `URL_PARAM_TO_COLUMN` 에 `plan_group / building / roomGroup` 3개 파라미터 추가.

## 데이터 소스 (확정)
`defect_items_raw` (`is_active = true`)에서 GROUP BY. `status_raw` 실측 값은 `Open / Rectified / Re-Opened / Closed` 4종 → **매트릭스 집계도 `status_raw` exact match, 드릴다운도 `status=<원본값>` 부착**으로 통일. `completion_status`/`closure_status`는 이번 매트릭스 집계·드릴다운에 사용하지 않음(파생 배지는 raw-data에서 별도로 표시됨).

## 축·레이아웃 (프롬프트 정합)

### 탭
- Plot C = `plan_group ∈ {Plot C, Tower 3}`
- Plot D = `plan_group ∈ {Plot D, Tower 4}`

### 블록 (탭 내부 세로 배열)
탭 내부는 아래 3개 블록을 이 순서로 배치:
1. **Tower 블록** — `building` 정규화 후 `Tower / Tower 4` 계열 + Level ∉ 지하
2. **Podium 블록** — `building` 정규화 후 `Podium / Podium 1~4` 계열 + Level ∉ 지하
3. **지하(Basement) 블록** — `level_name` 정규화 후 `∈ {B1, B2, B3, B4, LG}` — **Tower·Podium 공통, Plot 하단에 단일 블록으로 배치** (Building 무관)

각 블록 = `행: Level × 열: Room Group` 교차표.

### 행(Level) 정렬
- 지상: 숫자 파싱 후 상→하 (예: L71 → L1)
- 지하: `LG → B1 → B2 → B3 → B4` 순
- "Others" 미분류 행은 블록 최하단, 회색 음영

### 열(Room Group) 순서 (고정)
`TENANT · BOH · FOH · STAIRCASE · LIFT · CARPARK · CARPARK RAMP · CORRIDOR · FACADE · N/A · Row Total`
- `FACADE` 열 = `FACADE` + `LANDSCAPE` 합산
- **`N/A` 열 = Room Group 빈값 항목, 회색 음영, 정규 열들과 시각적으로 분리하여 우측 끝(단, Row Total 왼쪽)**

## 셀 (6지표, 순서 고정)
```
ISSUED │ Open │ Rectified │ Re-Open │ Closed │ Closure%
```
- **표기 형식**: 각 상태 지표는 `건수 (비율%)` 병기 (예: `Closed: 80 (80%)`), 비율 기준 = ISSUED 대비.
- ISSUED = Open + Rectified + Re-Open + Closed 합 (건수만).
- Closure% = Closed / ISSUED. ISSUED = 0 인 셀은 `-`.
- Closure% 색상 코딩: `<40% 적색 / 40–80% 황색 / ≥80% 녹색`.
- `status_raw` 매칭 (대소문자·공백 무시, `Re-Open`↔`Re-Opened` 동의어): `Open / Rectified / Re-Opened / Closed`.

## 롤업 (프롬프트 8절 4단계, 모두 6지표 동일 적용)
1. **행 우측 Row Total** — 한 Level의 모든 Area 합
2. **블록 하단 Column Total** — 한 Area 열의 모든 Level 합
3. **블록 최하단 Building 소계 행** — Tower/Podium/Basement 블록 각각 아래에 표시
4. **탭 상단 Plot Grand Total 배너** — Plot 전체 6지표 + Plot Closure%

N/A 열은 모든 합계에 포함하되 별도 컬럼으로 유지 (회색 음영으로 시각 구분).

## 필터
- Team 다중 토글 (`Arch / Mech / Elec`), 미선택 = 전체.
- URL 상태: `plot: "C"|"D"` (기본 "C"), `teams: "Arch,Mech,Elec"` 콤마 문자열.

## 드릴다운 (SHAW `goRaw` 규약, 통합)

부착 순서: 항상 `source=dashboard` + `plot_group` + `team=` (선택 시) + 축 파라미터 + 지표 파라미터.

| 클릭 지점 | 축 파라미터 |
|---|---|
| 열 헤더 (Room Group) | `roomGroup=<name>` |
| Building 그룹 헤더 (Tower/Podium/Basement) | `building=<members: 콤마>` (Basement는 `level=B1,B2,B3,B4,LG`) |
| 행 헤더 (Building + Level) | `building=<name>` + `level=<Level x>` |
| Row Total | `level=<Level x>` |
| Col Total | `roomGroup=<name>` |
| Building 소계 | `building=<members>` |
| Plot Grand Total | `plot_group` 만 (탭에 이미 부착됨) |

| 셀 지표 클릭 | 지표 파라미터 (축에 추가) |
|---|---|
| ISSUED | 없음 |
| Open | `status=Open` |
| Rectified | `status=Rectified` |
| Re-Open | `status=Re-Opened` |
| Closed | `status=Closed` |
| Closure% (숫자) | `status=Closed` |

## 시각 요구
- 계층 병합 헤더: `Building > Area(Room Group) > 상태(6지표)`.
- Tower / Podium / Basement 블록을 시각적으로 구분(구분선·배경 톤).
- 지표 순서는 어떤 화면에서도 불변.
- 참조: 샘플 파일 `복사본_MECH_De-Snagging_work_repor_t_PLOT_C_D_09-July_Rev02.xlsx` 의 **보이는 시트만** (`Summary_C`, `C-Report-T`, `C-Report-P.L.B`, `Snagging(Overall)_C`) 레이아웃을 형태 기준으로 삼되, 수식·값·시트 분리 방식은 복제하지 않음. 숨김 시트(`Summary_D` 등)는 무시.

## 신규 파일
- `src/routes/_authenticated/closure/snag-management/dashboard.tsx` (route + `validateSearch: {plot, teams}`)
- `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx` (탭·Team 토글·Plot Grand Total 배너)
- `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx` (한 Building 블록의 Level×Area 매트릭스 + 소계)
- `src/components/defect-management/dashboard/DeSnagStatusCell.tsx` (6지표 셀, `건수 (%)` 표기, Closure% 색상)
- `src/components/defect-management/dashboard/DeSnagToolbar.tsx` (Team 다중 토글)
- `src/lib/defect-management/dashboard.functions.ts` — `getSnagDashboardMatrix({plot, teams})`: `defect_items_raw` GROUP BY `plan_group, building, level_name, room_group, status_raw`
- `src/lib/defect-management/dashboard-shape.ts` — 축 정규화·정렬·소계 계산 유틸

## 수정 파일
- `src/components/layout/AppLayout.tsx` — 사이드바 Dashboard 링크 추가
- `src/components/defect-management/outstanding/OutstandingDashboardPage.tsx` — Snag 카드 `to` 교체
- `src/components/defect-management/raw-data/DefectRawDataPage.tsx` — `URL_PARAM_TO_COLUMN` 에 `plan_group → plan_group`, `building → building`, `roomGroup → room_group` 3키 추가
- `src/routes/_authenticated/closure/snag-management/raw-data.tsx` — `validateSearch` 에 `plan_group / building / roomGroup` 3키 추가, `DRILLDOWN_PARAMS` 배열에 포함

## 변경 없음
- DB 스키마·마이그레이션·RLS, `derived.ts`, Import 파이프라인
- `filter-fns.ts` 스펙, 기존 컬럼 정의
- SHAW 규약 URL 파라미터 파서 본체, 필터 칩 표시 로직
- `DefectDetailPage.tsx`
