## 목표
TM 대시보드처럼 Task Summary와 Raw Data 페이지 최상단에도 **Data Date 선택기**를 추가하여, 각 페이지의 "오늘 기준" 계산을 사용자가 고른 날짜로 연동한다. 기본값은 DB에 있는 최신 `data_date`.

## 현재 상태 (확인 완료)
- `TmDashboardPage.tsx`: 이미 `search.dataDate` URL 파라미터 + Select 드롭다운으로 Data Date 선택 UI 보유. `dataDateOptions`는 `task_management_raw` 전체에서 distinct 추출.
- `TaskManagementRawDataPage.tsx`: `latestDataDate`를 계산해 Badge로 "Data Date {값}"만 표시. `TaskStageProgress`에 이 값을 `dataDate` prop으로 전달만 함. 선택 UI 없음.
- `TaskTreePage.tsx` (Task Summary): `todayGap` / `expectedProgressToday`를 호출하는데, 이 함수들은 내부적으로 오늘 날짜(또는 `computeTPlan` 기본값)를 사용. Data Date 인자를 받지 않음.
- `derived.ts`: `computeTPlan(row, asOf?)`는 이미 asOf 인자 지원. `expectedProgressToday(row)`와 `todayGap(row)`는 asOf 인자 미지원 → 확장 필요.

## 구현 범위

### 1. 공용 훅/컴포넌트
- `src/components/task-management/shared/DataDatePicker.tsx` 신설
  - props: `value`, `onChange`, `options`(distinct data_date 목록), 기본 라벨/리셋 버튼.
  - Dashboard의 기존 UI(Select + 리셋)와 동일 스타일 재사용.
- 데이터 소스는 각 페이지가 이미 가지고 있는 rows에서 distinct 추출(추가 쿼리 없음).

### 2. Raw Data 페이지
- 상단 헤더 라인에 DataDatePicker 배치(기존 "Data Date {값}" Badge 자리 교체).
- 상태: `selectedDataDate` (URL search param `dataDate`; 미지정 시 latestDataDate).
- `TaskStageProgress`로 넘기는 `dataDate` prop을 `selectedDataDate`로 교체.
- **완료 회색 스타일** 및 `auto_judgment` 값은 DB 저장값을 그대로 사용(서버 계산이라 Data Date와 무관) → 시각적 stage progress에만 영향.

### 3. Task Summary 페이지
- 상단에 DataDatePicker 배치.
- 상태: URL search param `dataDate`; 기본값 = rows의 max `data_date`.
- `derived.ts`에 확장:
  - `expectedProgressToday(row, asOf?)` → `computeTPlan(row, asOf) ?? 0`
  - `todayGap(row, asOf?)` → `actual - expectedProgressToday(row, asOf)`
  - 기존 호출부(인자 없이 쓰던 곳)는 그대로 동작(옵셔널).
- `TaskTreePage.tsx` 내 모든 `todayGap(row)` / `expectedProgressToday(row)` 호출을 `todayGap(row, selectedDataDate)`로 교체.
- `exportTaskSummary.ts`에도 동일 asOf 전달(export가 현재 화면 기준을 반영하도록).

### 4. URL 파라미터
- Raw Data / Task Summary 각각 `validateSearch`에 `dataDate: fallback(z.string(), "").default("")` 추가.
- 페이지 진입 시 값이 비어있으면 latestDataDate로 표시(URL은 그대로 비워두어 "최신" 자동 추종 동작 유지).

## 비범위
- `auto_judgment` 서버 재계산은 별도 버튼(이미 존재)으로만 실행. Data Date 변경으로 자동 재계산 트리거하지 않음.
- Dashboard의 Data Date와 페이지 간 자동 동기화는 하지 않음(각 페이지 독립 URL 상태). 필요 시 별도 요청.

## 확인 필요
없음. 위 방식대로 진행합니다.
