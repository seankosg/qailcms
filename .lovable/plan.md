## 목표
SM Progress Matrix의 일일 컬럼 영역에서 2026-07-21까지의 과거 일일 컬럼을 숨기고, 그 자리에 누계 컬럼 하나를 삽입한다. day 버킷 뷰에만 적용하고 week 뷰는 현행 유지한다.

## 변경 파일

### 1) src/components/defect-management/progress/SnagProgressPage.tsx
- `matrix` useMemo 리팩터:
  - 상수 `CUTOFF = "2026-07-22"`, `CUM_ISO = "2026-07-21"`.
  - `bucket === "day"`일 때만 누계 병합 수행.
  - `assembleMatrix` 결과 `full`에서 인덱스 `[0, preRange)` (b < CUTOFF) 셀을 row·stage·combined 별로 plan/actual 합산.
  - 표시 시작 `visStart = hidePast ? max(preRange, todayIdx) : preRange`.
  - 최종 `buckets = [CUM_ISO, ...full.buckets.slice(visStart)]`.
  - 각 row의 `combined` 및 `stages.{start,rectified,closure}.cells`를 `[cumCell, ...tail]`로 재구성. `total/doneCount/cumPlan/cumActual`는 전체 누계이므로 그대로.
  - `bucket === "week"`: 기존 hidePast 슬라이스만 유지.
- `SnagScheduleMatrix`에 `cumBucketIso={bucket === "day" ? "2026-07-21" : undefined}` 전달.

### 2) src/components/defect-management/progress/SnagScheduleMatrix.tsx
- Props에 `cumBucketIso?: string` 추가.
- 타임라인 헤더 렌더링에서 `i === 0 && data.buckets[0] === cumBucketIso`인 경우 라벨을 커스텀:
  - 상단 작은 글씨 `Up to` (`text-[9px] text-muted-foreground leading-tight`)
  - 하단 큰 글씨 `21-Jul` (`formatDdMmm("2026-07-21")` 사용, 기존 primary 스타일)
- 그 외 컬럼은 `formatBucketLabel` 그대로.
- `todayBucketIdx`, 셀 클릭 콜백, 오늘 하이라이트, 스티키 좌측(Total Scope / Up to asOfLabel)은 변경 없음.

## 유지 사항
- KPI 카드 값 및 좌측 스티키 블록(누적 Plan/Actual/Diff/%) 로직 불변.
- 셀 클릭 시 bucketIso `2026-07-21`가 전달되어 기존 Raw Data 이동 로직 유지("나머지는 그대로").
- hidePast, planMode, stage 필터, plot/team 필터, RPC 파라미터 및 캐시 키 모두 변경 없음.

## 검증
- day 뷰: 첫 컬럼 라벨 `Up to / 21-Jul`, 값 = 이전 일일 컬럼들의 plan/actual 합; 이후 컬럼은 2026-07-22부터 표시.
- hidePast on/off 전환 시 첫 컬럼 유지, 이후 컬럼만 슬라이스.
- week 뷰: 라벨/컬럼 구성 현행 유지.
- 다중 stage 선택 시 stage 행과 combined 행 모두 첫 컬럼 값이 stage 합계와 일치.
