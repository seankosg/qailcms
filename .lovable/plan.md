## 범위
`src/components/defect-management/progress/SnagProgressPage.tsx` KPI 카드 재구성 + Snag Progress/Dashboard 상단에 Data Date 선택기 도입. 매트릭스/차트 로직은 무변경.

---

## 1. KPI 카드 재구성 (SM Progress)

파일: `src/components/defect-management/progress/SnagProgressPage.tsx`

- Range 카드 제거 → 5개 카드로 축소 (`lg:grid-cols-6` → `lg:grid-cols-5`).
- 라벨 변경:
  - `Cum. Plan` → **PLAN**
  - `Cum. Actual` → **ACTUAL**
  - `Variance` → **DIFFERENCE**
  - `Done Stages` → **DONE**
  - `Progress` → **PROGRESS** (유지)
- 카드 내부 레이아웃을 좌/우 2-컬럼으로 개편(카드 크기 현행 유지). 좌측: 라벨 + 총계. 우측: **Stage 별 breakdown**(Start / Rect / Close 3줄, 우측 정렬 tabular-nums, 10px muted).
- Stage별 값 계산 (`totalsQ.data`를 `effectiveStages`로 필터한 뒤 stage별 집계 map 생성):
  - PLAN: `plan_upto` per stage
  - ACTUAL: `actual_upto` per stage
  - DIFFERENCE: `actual_upto - plan_upto` per stage (부호 포함)
  - DONE: `done_upto / total` per stage
  - PROGRESS: stage별 `done_upto / total * 100` (0 division 시 `-`)
- DIFFERENCE 카드 본체 값: 절대 차이 `ACTUAL - PLAN` (+면 초록 `text-schedule-over`, −면 빨강 `text-schedule-short`). 값 오른쪽에 작은 % 배지 `(±xx.x%)`, plan=0이면 `—`.
- `KpiCard`를 좌/우 슬롯 + `stageBreakdown` + `onClick`(총계/스테이지 각각) 프롭 받는 형태로 확장.

### 1-1. 카드 클릭 → Raw Data 이동 (기존필터 리셋)
- 카드 본체(총계) 또는 우측 Stage 뱃지 클릭 시 Raw Data로 이동. `window.location.assign`로 이동하여 기존 Raw Data URL 파라미터를 완전히 대체(리셋 보장).
- 파라미터 구성 규칙 (Progress 페이지의 Plot/Team/RoomGroup/asOfDate만 승계, 그 외 Raw Data 필터는 넘기지 않음):
  - 공통: `source=progress-kpi`, `plan_group=planGroupsForPlot(plot)`, 필요 시 `team`, `roomGroup`, `asOfDate=effectiveDataDate`
  - 카드별 필터:
    - **PLAN**: `dateField=<stage.planned>`, `dateEnd=effectiveDataDate` (계획 <= as-of)
    - **ACTUAL**: `dateField=<stage.actual>`, `dateEnd=effectiveDataDate` (실제 <= as-of, 완료건)
    - **DIFFERENCE**: `ACTUAL` 카드와 동일 URL (실적 목록). 별도 정의 없음 안내는 생략.
    - **DONE**: 총계 클릭 = 전체 대상(`status=Open,Rectified,Re-Opened,Closed` 미지정, 즉 활성 전체). Stage 뱃지 클릭 = 해당 stage 완료건 (= ACTUAL 규칙).
    - **PROGRESS**: DONE과 동일.
  - 총계(전체 stage) 클릭 시: `stage` 파라미터 미설정, `dateField`는 `stage="all"` 매핑(=`*_rectified_date`) 사용.
  - Stage 뱃지 클릭 시: `stage=<start|rectified|closure>` 추가.
- `stageDateField(stage, "planned"|"actual")` (`progress-utils.ts`)는 그대로 재사용.

---

## 2. Data Date 선택기

### 2-1. 공용 훅 신설
`src/hooks/useDefectLatestDataDate.ts` (신규)
- `supabase.from("defect_items_raw").select("data_date").eq("is_active", true).not("data_date","is",null)` → 클라이언트 distinct → 내림차순. `latest = arr[0]`.
- 반환 `{ options: string[], latest: string | null, isLoading }`. staleTime 5분.

### 2-2. URL 파라미터 추가
- `src/routes/_authenticated/closure/snag-management/progress.tsx` `searchSchema`에 `dataDate: fallback(z.string(), "").default("")` 추가.
- `src/routes/_authenticated/closure/snag-management/dashboard.tsx` 동일 추가.

### 2-3. Progress 페이지 통합
- `useDefectLatestDataDate()` → `effectiveDataDate = search.dataDate || latest || todayIso()`.
- 기존 `asOfDate = today`를 `asOfDate = effectiveDataDate` 로 교체. `asOfLabel`은 선택된 날짜 문자열 표시.
- 헤더 "Snag Progress Status" 라벨 옆에 `DataDatePicker`(`src/components/task-management/shared/DataDatePicker.tsx` 재사용) 배치. `onReset` = `dataDate` 파라미터 클리어.
- 기존 toolbar의 `As-of` (Data Date / Today) ToggleGroup 유지(로직 영향 없음, 표시 라벨만).

### 2-4. Dashboard 페이지 통합
- `DeSnagDashboardPage.tsx` 헤더 "De-Snagging Dashboard" 옆에 동일 `DataDatePicker` 배치.
- `useSnagDashboardMatrix(plot, teams, dataDate)` 로 시그니처 확장, RPC 호출 시 `_as_of_date` 인자 추가.

### 2-5. 마이그레이션 (Dashboard RPC 확장)
- `defect_snag_dashboard_matrix(_plan_groups, _teams)` → `(_plan_groups, _teams, _as_of_date date default null)`. 내부 where 절에 `and (_as_of_date is null or data_date <= _as_of_date)` 추가. Grant 동일.

---

## 미확인 사항
- DIFFERENCE 색상 규칙: +=초록/−=빨강 가정. 반대로 원하시면 알려주세요.
- KPI 카드 뱃지 클릭 시 Raw Data가 승계할 필터 범위를 "Plot/Team/RoomGroup/asOfDate + 카드별 stage/date"로 최소화합니다(기존 Raw Data URL은 완전 리셋). 다른 승계 규칙 원하시면 알려주세요.

## 검증
- Progress: 카드 5개(Range 없음), DONE 라벨, DIFFERENCE 부호/색/%. Stage breakdown 3줄 표시.
- KPI 카드/뱃지 클릭 → Raw Data 이동, 기존 URL 필터가 초기화되고 새 파라미터만 적용됨.
- Progress/Dashboard: Data Date 변경 시 매트릭스·KPI 재조회.